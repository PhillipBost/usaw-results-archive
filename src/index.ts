import { Command } from 'commander';
import { CdxClient, CdxResult } from './cdx';
import { Downloader } from './downloader';
import { CONFIG, ERAS } from './config';
import { Categorizer, FileCategory } from './categorizer';
import pino from 'pino';
import fs from 'fs-extra';
import path from 'path';

// Inventory Type
interface InventoryItem {
    id: string; // urlkey or similar unique id
    era: string;
    year: number;
    category: FileCategory;
    filename: string;
    originalUrl: string;
    waybackUrl: string;
    timestamp: string;
    status: 'discovered' | 'downloaded' | 'failed' | 'skipped';
    localPath?: string;
}

// Initialize logger with pino-pretty transport inline to avoid complexity or ensure it's simple
const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
});

const program = new Command();

program
    .name('usaw-scraper')
    .description('Scrape USA Weightlifting documents from Wayback Machine')
    .version('1.0.0')
    .option('-d, --dry-run', 'simulate actions without writing files')
    .option('-l, --limit <number>', 'limit the number of items per domain (discovery) or total (download)', parseInt)
    .option('--discover', 'run discovery and generate/update inventory.json')
    .option('--download', 'download files listed in inventory.json (requires --discover first or existing inventory)')
    .option('--era <name>', 'target specific era (early-web, msbn, hangastar)')
    .option('--year <number>', 'target specific year (overrides era settings)', parseInt)
    .option('--from <number>', 'start year (custom range)', parseInt)
    .option('--to <number>', 'end year (custom range)', parseInt)
    .parse(process.argv);

async function main() {
    const options = program.opts();

    logger.info('Starting USAW Results Archive Scraper...');
    if (options.dryRun) logger.info('Running in DRY-RUN mode');

    // Determine Era/Targets
    let targets = CONFIG.SEARCH_TARGETS; // Default
    let startYear: number | undefined = options.from;
    let endYear: number | undefined = options.to;
    let selectedEraId = 'custom';

    if (options.era) {
        const era = ERAS[options.era];
        if (!era) {
            logger.error(`Unknown era: ${options.era}. Available eras: ${Object.keys(ERAS).join(', ')}`);
            process.exit(1);
        }
        logger.info(`Targeting Era: ${era.description}`);
        targets = era.targets;
        // Set date range from Era if not manually overridden
        if (!startYear) startYear = era.startYear;
        if (!endYear) endYear = era.endYear;
        selectedEraId = era.id;
    }

    if (options.year) {
        logger.info(`Targeting Year: ${options.year}`);
        startYear = options.year;
        endYear = options.year;
    }

    if (options.discover) {
        await runDiscovery({ ...options, targets, startYear, endYear, eraId: selectedEraId });
    } else if (options.download) {
        await runDownload(options);
    } else {
        // Default behavior (legacy): Run both? Or just show help?
        // Let's keep legacy behavior as default for now: Discover -> Download immediately
        logger.info('No specific mode selected. Running full Discovery + Download cycle.');
        await runFullCycle({ ...options, targets, startYear, endYear, eraId: selectedEraId });
    }

    logger.info('Operation complete.');
}

async function runDiscovery(options: any) {
    logger.info('Starting Discovery Mode...');
    const cdxClient = new CdxClient();
    const inventoryPath = 'inventory.json';

    let inventory: InventoryItem[] = [];
    if (await fs.pathExists(inventoryPath)) {
        try {
            inventory = await fs.readJSON(inventoryPath);
            logger.info(`Loaded existing inventory with ${inventory.length} items`);
        } catch (e) {
            logger.warn('Failed to load existing inventory, starting fresh.');
        }
    }

    for (const target of options.targets) {
        logger.info(`Searching CDX for target: ${target} (${options.startYear || 'All'} - ${options.endYear || 'All'})`);
        try {
            const results = await cdxClient.search(target, { from: options.startYear, to: options.endYear });
            logger.info(`Found ${results.length} matching documents for ${target}`);

            let filesToProcess = results;
            if (options.limit && options.limit > 0) {
                filesToProcess = results.slice(0, options.limit);
                logger.info(`Limiting to first ${options.limit} files`);
            }

            for (const r of filesToProcess) {
                const year = parseInt(r.timestamp.substring(0, 4));
                let filename = path.basename(r.original.split('?')[0]) || `file-${r.digest}.dat`;

                // If URL has query params, or filename is very generic/short, append digest to ensure uniqueness and context
                if (r.original.includes('?') || filename.length < 5 || filename.match(/^index\./)) {
                    const ext = path.extname(filename);
                    const name = path.basename(filename, ext);
                    filename = `${name}-${r.digest.substring(0, 8)}${ext}`;
                }

                // Normalize .aspx/.asp to .html for easier viewing
                if (filename.match(/\.(aspx|asp)$/i)) {
                    filename = filename.replace(/\.(aspx|asp)$/i, '.html');
                }

                const category = Categorizer.categorize(filename, r.original);

                // Construct basic ID to check for dupes in inventory logic could be improved
                const id = r.digest;

                // Check if already in inventory
                const exists = inventory.some(i => i.id === id);
                if (!exists) {
                    const item: InventoryItem = {
                        id,
                        era: options.eraId || 'unknown',
                        year,
                        category,
                        filename,
                        originalUrl: r.original,
                        waybackUrl: `http://web.archive.org/web/${r.timestamp}id_/${r.original}`,
                        timestamp: r.timestamp,
                        status: 'discovered'
                    };
                    inventory.push(item);
                }
            }

        } catch (error) {
            logger.error(error, `Error processing target ${target}`);
        }
    }

    if (options.dryRun) {
        logger.info(`[DRY-RUN] Would write ${inventory.length} items to ${inventoryPath}`);
    } else {
        await fs.writeJSON(inventoryPath, inventory, { spaces: 2 });
        logger.info(`Saved ${inventory.length} items to ${inventoryPath}`);
    }
}

async function runDownload(options: any) {
    const inventoryPath = 'inventory.json';
    logger.info(`Starting Download Mode from ${inventoryPath}...`);

    if (!await fs.pathExists(inventoryPath)) {
        logger.error(`Inventory file not found: ${inventoryPath}. Run --discover first.`);
        return;
    }

    let inventory: InventoryItem[] = await fs.readJSON(inventoryPath);
    // Filter for items that are just discovered or failed
    let itemsToProcess = inventory.filter(i => i.status === 'discovered' || i.status === 'failed');

    if (options.limit && options.limit > 0) {
        itemsToProcess = itemsToProcess.slice(0, options.limit);
        logger.info(`Limiting downloads to first ${options.limit} items`);
    }

    if (itemsToProcess.length === 0) {
        logger.info('No new items to download.');
        return;
    }

    const downloader = new Downloader(); // Use existing instance? Or update it to handle custom paths?
    // We need to modify Downloader or handle paths purely here. 
    // Existing Downloader logic is a bit rigid (data/year/file). 
    // Let's instantiate it but we'll manually handle the logic by reusing its method IF it supports path override 
    // OR we just reimplement simple download here or update Downloader. 
    // Updating Downloader is cleaner. But for now, let's assume we update Downloader to accept 'localPath'.
    // Actually, let's just do the download Logic here or call a simple helper. 
    // The existing Downloader class calculates path internally. We should probably update it to accept a target path.
    // Let's refactor Downloader slightly or just do it here for now to save tool calls if Downloader is simple?
    // Downloader has 30 lines. Let's JUST IMPORT fs/axios and do it here or update it? 
    // Let's assume we can pass a destination path to Downloader.downloadFile(result, destination)? 
    // No, existing signature doesn't support it. 

    // Let's just create the folder structure here: data/{Era}/{Year}/{Category}/{Filename}
    const dataDir = CONFIG.DATA_DIR;

    const batchSize = CONFIG.CONCURRENT_DOWNLOADS || 5;
    for (let i = 0; i < itemsToProcess.length; i += batchSize) {
        const batch = itemsToProcess.slice(i, i + batchSize);

        if (options.dryRun) {
            batch.forEach(item => {
                const targetPath = path.join(dataDir, item.era, item.year.toString(), item.category, item.filename);
                logger.info(`[DRY-RUN] Would download: ${item.originalUrl} to ${targetPath}`);
            });
        } else {
            await Promise.all(batch.map(async (item) => {
                try {
                    const targetDir = path.join(dataDir, item.era, item.year.toString(), item.category);
                    await fs.ensureDir(targetDir);
                    const targetPath = path.join(targetDir, item.filename);

                    // Check if file exists. If so, skip download but potentially post-process.
                    let downloaded = false;
                    if (await fs.pathExists(targetPath)) {
                        logger.info(`Skipping download (exists): ${targetPath}`);
                        downloaded = true;
                    }

                    if (!downloaded) {
                        // Download logic
                        // We can use the CdxResult-like object or just manual axios
                        const response = await require('axios')({
                            url: item.waybackUrl,
                            method: 'GET',
                            responseType: 'stream',
                            timeout: 30000,
                        });

                        const writer = fs.createWriteStream(targetPath);
                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });
                    }

                    // Post-process HTML files to improve readability (inject basic CSS)
                    if (targetPath.endsWith('.html')) {
                        try {
                            const content = await fs.readFile(targetPath, 'utf-8');

                            // Use Cheerio for robust HTML parsing
                            const cheerio = require('cheerio');
                            const $ = cheerio.load(content);

                            // Offline Asset Archiving
                            // 1. Create assets directory for this Era
                            const assetsDir = path.join(dataDir, item.era, 'assets');
                            await fs.ensureDir(assetsDir);

                            const timestamp = item.timestamp;
                            const waybackPrefix = `http://web.archive.org/web/${timestamp}id_`;
                            const waybackImgPrefix = `http://web.archive.org/web/${timestamp}im_`;

                            // Helper to resolve relative paths to absolute Wayback URLs
                            const resolveUrl = (rel: string) => {
                                if (!rel) return '';
                                if (rel.startsWith('http')) return rel;
                                try {
                                    const u = new URL(rel, item.originalUrl);
                                    // Strip standard ports for better matching with Wayback
                                    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
                                        u.port = '';
                                    }
                                    return u.toString();
                                } catch (e) { return rel; }
                            };

                            // Helper to download asset
                            const downloadAsset = async (url: string, isImage: boolean): Promise<string | null> => {
                                if (!url) return null;
                                let cleanUrl = url;
                                // Double check if url has default port and strip it just in case
                                try {
                                    const u = new URL(url);
                                    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
                                        u.port = '';
                                        cleanUrl = u.toString();
                                    }
                                } catch { }

                                logger.info(`Attempting download for asset: ${cleanUrl}`);
                                try {
                                    // Step 1: Resolve to absolute URL if needed
                                    let absoluteUrl = cleanUrl;
                                    if (!cleanUrl.startsWith('http')) {
                                        absoluteUrl = resolveUrl(cleanUrl);
                                        logger.info(`  Resolved relative URL to: ${absoluteUrl}`);
                                    }

                                    // Step 2: Construct Wayback URL from the absolute URL
                                    let assetWaybackUrl: string;
                                    if (absoluteUrl.includes('web.archive.org')) {
                                        // Already a wayback URL, use as-is
                                        assetWaybackUrl = absoluteUrl;
                                        logger.info(`  Already Wayback URL: ${assetWaybackUrl}`);
                                    } else {
                                        // Add Wayback Machine prefix
                                        const prefix = isImage ? waybackImgPrefix : waybackPrefix;
                                        assetWaybackUrl = `${prefix}/${absoluteUrl}`;
                                        logger.info(`  Constructed Wayback URL: ${assetWaybackUrl}`);
                                    }

                                    // Generate local filename (MD5 of the full Wayback URL to ensure uniqueness per version)
                                    const crypto = require('crypto');
                                    const hash = crypto.createHash('md5').update(assetWaybackUrl).digest('hex');
                                    const ext = path.extname(cleanUrl.split('?')[0]) || (isImage ? '.jpg' : '.css');

                                    // Handle cases where ext might be too long or invalid
                                    const safeExt = ext.length > 5 ? (isImage ? '.jpg' : '.css') : ext;
                                    const localFilename = `${hash}${safeExt}`;
                                    const localPath = path.join(assetsDir, localFilename);

                                    // Download if not exists OR is empty (0 bytes)
                                    const fileExists = await fs.pathExists(localPath);
                                    const fileSize = fileExists ? (await fs.stat(localPath)).size : 0;

                                    if (!fileExists || fileSize === 0) {
                                        // Recursive function to handle Wayback redirects
                                        const fetchWayback = async (url: string, retries = 3): Promise<any> => {
                                            try {
                                                const res = await require('axios')({
                                                    url: url,
                                                    method: 'GET',
                                                    responseType: 'arraybuffer',
                                                    timeout: 30000,
                                                    maxRedirects: 0, // Manual redirect handling
                                                    headers: {
                                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                                                    },
                                                    validateStatus: (status: number) => status < 400 // Accept 3xx as success to handle manually
                                                });

                                                // Handle Redirects (3xx)
                                                if (res.status >= 300 && res.status < 400) {
                                                    const location = res.headers.location || res.headers.Location;
                                                    if (location) {
                                                        logger.info(`  Handling Wayback redirect ${res.status} to: ${location}`);

                                                        // If redirect satisfies Wayback format, follow it
                                                        if (location.includes('web.archive.org/web/')) {
                                                            if (retries > 0) return fetchWayback(location, retries - 1);
                                                            return null;
                                                        }

                                                        // If redirect is to live web (dead server), rewrite to Wayback
                                                        // Extract timestamp from current URL to maintain consistency
                                                        // Format: .../web/YYYYMMDDHHMMSSid_/http...
                                                        const tsMatch = url.match(/\/web\/(\d{14})id_\//);
                                                        const timestamp = tsMatch ? tsMatch[1] : item.timestamp;

                                                        // Check if location is relative
                                                        let targetUrl = location;
                                                        if (!location.startsWith('http')) {
                                                            // this is tricky with wayback rewriting, but let's assume absolute for now or try resolve
                                                            try {
                                                                const baseUrl = url.split('id_/')[1]; // original url part
                                                                if (baseUrl) {
                                                                    targetUrl = new URL(location, baseUrl).toString();
                                                                }
                                                            } catch (e) { }
                                                        }

                                                        // Construct new Wayback URL
                                                        const waybackRedirectUrl = `http://web.archive.org/web/${timestamp}id_/${targetUrl}`;
                                                        logger.info(`  Rewrote redirect to Wayback: ${waybackRedirectUrl}`);

                                                        if (retries > 0) return fetchWayback(waybackRedirectUrl, retries - 1);
                                                    }
                                                    return null; // Redirect without location?
                                                }
                                                return res;
                                            } catch (e: any) {
                                                throw e;
                                            }
                                        };

                                        try {
                                            let response: any = null;
                                            try {
                                                response = await fetchWayback(assetWaybackUrl);
                                            } catch (err: any) {
                                                logger.warn(`  Primary fetch failed for ${cleanUrl}: ${err.message}`);
                                            }

                                            // Fallback: If response is empty or failed, try CDX API lookup
                                            if (!response || (response.status === 200 && (!response.data || response.data.length === 0))) {
                                                logger.warn(`Primary download failed/empty for ${cleanUrl}. Attempting CDX lookup...`);

                                                try {
                                                    // Extract original URL from Wayback URL or use cleanUrl if absolute
                                                    let originalUrl = cleanUrl;
                                                    if (!cleanUrl.startsWith('http')) {
                                                        // It was relative, we need the absolute URL it resolved to
                                                        // We can try to extract it from assetWaybackUrl or just use the absoluteUrl calculated above
                                                        originalUrl = absoluteUrl;
                                                    }

                                                    // If absoluteUrl is a wayback url, we need to extract the original
                                                    if (originalUrl.includes('/http')) {
                                                        originalUrl = originalUrl.split('/http')[1];
                                                        if (!originalUrl.startsWith('http')) originalUrl = 'http' + originalUrl;
                                                    }

                                                    // Use CDX API
                                                    // http://web.archive.org/cdx/search/cdx?url={url}&output=json&limit=1&closest={timestamp}
                                                    // Use the timestamp from the item we are processing to stay in sync
                                                    const timestamp = item.timestamp || '20060101';
                                                    const cdxUrl = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(originalUrl)}&output=json&limit=1&closest=${timestamp}`;

                                                    logger.info(`  Querying CDX: ${cdxUrl}`);
                                                    const cdxRes = await require('axios').get(cdxUrl, { timeout: 15000, validateStatus: () => true });

                                                    if (cdxRes.status === 200 && cdxRes.data && cdxRes.data.length > 1) {
                                                        const row = cdxRes.data[1]; // [urlkey, timestamp, original, mimetype, statuscode, digest, length]
                                                        const ts = row[1];

                                                        // Construct direct URL
                                                        const directUrl = `http://web.archive.org/web/${ts}id_/${originalUrl}`;
                                                        logger.info(`  CDX found snapshot: ${directUrl}`);

                                                        // Retry download with new URL
                                                        response = await fetchWayback(directUrl);
                                                    }
                                                } catch (cdxErr: any) {
                                                    logger.warn(`  CDX lookup failed: ${cdxErr.message}`);
                                                }
                                            }

                                            // Only write if we got content and 200 OK
                                            if (response && response.status === 200 && response.data && response.data.length > 0) {
                                                await fs.writeFile(localPath, response.data);
                                                logger.info(`  Downloaded asset: ${cleanUrl} (${response.data.length} bytes)`);
                                                return localFilename;
                                            } else {
                                                if (response && response.status === 200 && response.data.length === 0) {
                                                    logger.warn(`Got empty response for ${cleanUrl}`);
                                                } else if (response) {
                                                    logger.warn(`Failed to resolve asset ${cleanUrl} (Status: ${response.status})`);
                                                }
                                                return null;
                                            }
                                        } catch (e: any) {
                                            logger.warn(`Failed to download asset ${cleanUrl}: ${e.message}`);
                                            return null;
                                        }
                                    }

                                    // Return relative path from the HTML file to the asset
                                    // HTML is in data/{Era}/{Year}/{Category}/
                                    // Assets are in data/{Era}/assets/
                                    return `../../assets/${localFilename}`;

                                } catch (e: any) {
                                    logger.warn(`Failed to download asset ${cleanUrl}: ${e.message}`);
                                    return null;
                                }
                            };

                            // PHASE 1: Collect ALL asset URLs before starting any downloads
                            // This prevents race conditions where DOM modifications interfere with URL reading
                            const assetsToProcess: Array<{ element: any, url: string, isImage: boolean, attr: string }> = [];

                            // Collect images
                            $('img').each((_: any, el: any) => {
                                const src = $(el).attr('src');
                                if (src && !src.startsWith('data:') && !src.startsWith('#') && !src.startsWith('..')) {
                                    assetsToProcess.push({ element: el, url: src, isImage: true, attr: 'src' });
                                }
                            });

                            // Collect CSS
                            const linkTags = $('link');
                            logger.info(`Found ${linkTags.length} total links in ${targetPath}`);
                            linkTags.each((_: any, el: any) => {
                                const href = $(el).attr('href');
                                const rel = $(el).attr('rel');
                                const type = $(el).attr('type');

                                const isStylesheet = (rel && rel.toLowerCase().includes('stylesheet')) || (type && type.toLowerCase() === 'text/css');

                                if (isStylesheet && href && !href.startsWith('data:') && !href.startsWith('#') && !href.startsWith('..')) {
                                    logger.info(`Found stylesheet href: ${href}`);
                                    assetsToProcess.push({ element: el, url: href, isImage: false, attr: 'href' });
                                }
                            });

                            // Collect scripts
                            $('script[src]').each((_: any, el: any) => {
                                const src = $(el).attr('src');
                                if (src && !src.startsWith('data:') && !src.startsWith('#') && !src.startsWith('..')) {
                                    assetsToProcess.push({ element: el, url: src, isImage: false, attr: 'src' });
                                }
                            });

                            logger.info(`Collected ${assetsToProcess.length} assets todownload`);

                            // PHASE 2: Download all assets and collect results
                            const downloadPromises = assetsToProcess.map(async (asset) => {
                                const localLink = await downloadAsset(asset.url, asset.isImage);
                                return { asset, localLink };
                            });

                            const results = await Promise.all(downloadPromises);

                            // PHASE 3: Apply all URL rewrites to DOM
                            for (const { asset, localLink } of results) {
                                if (localLink) {
                                    $(asset.element).attr(asset.attr, localLink);
                                }
                            }


                            await fs.writeFile(targetPath, $.html());
                        } catch (err) {
                            logger.warn(`Failed to process assets for ${targetPath}: ${err}`);
                        }
                    }

                    item.status = 'downloaded';
                    item.localPath = targetPath;
                    logger.info(`Downloaded & Processed: ${targetPath}`);
                } catch (err: any) {
                    logger.error(`Failed ${item.originalUrl}: ${err.message}`);
                    item.status = 'failed';
                }
            }));

            // Save inventory progress periodically
            await fs.writeJSON(inventoryPath, inventory, { spaces: 2 });
        }

        logger.info(`Processed ${Math.min(i + batchSize, itemsToProcess.length)}/${itemsToProcess.length}`);
    }
}

async function runFullCycle(options: any) {
    // Legacy support wrapper
    await runDiscovery(options);
    await runDownload(options);
}

main().catch(err => {
    logger.error(err, 'Unhandled exception in main loop');
    process.exit(1);
});
