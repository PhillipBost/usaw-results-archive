import { Command } from 'commander';
import { CdxClient, CdxResult } from './cdx';
import { Downloader } from './downloader';
import { CONFIG, ERAS } from './config';
import { Categorizer, FileCategory } from './categorizer';
import pino from 'pino';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { URL } from 'url';

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

// Initialize logger
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
    .option('--inventory <path>', 'custom inventory file path', 'inventory.json')
    .option('--era <name>', 'target specific era (early-web, msbn, hangastar)')
    .option('--year <number>', 'target specific year (overrides era settings)', parseInt)
    .option('--from <number>', 'start year (custom range)', parseInt)
    .option('--to <number>', 'end year (custom range)', parseInt)
    .parse(process.argv);

async function main() {
    const options = program.opts();

    logger.info('Starting USAW Results Archive Scraper (Native Relative Paths Mode)...');
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
        logger.info('No specific mode selected. Running full Discovery + Download cycle.');
        await runFullCycle({ ...options, targets, startYear, endYear, eraId: selectedEraId });
    }

    logger.info('Operation complete.');
}

async function runDiscovery(options: any) {
    logger.info('Starting Discovery Mode...');
    const cdxClient = new CdxClient();
    const inventoryPath = options.inventory || 'inventory.json';

    let inventory: InventoryItem[] = [];
    if (await fs.pathExists(inventoryPath)) {
        try {
            inventory = await fs.readJSON(inventoryPath);
            logger.info(`Loaded existing inventory with ${inventory.length} items from ${inventoryPath}`);
        } catch (e) {
            logger.warn(`Failed to load existing inventory from ${inventoryPath}, starting fresh.`);
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

                if (r.original.includes('?') || filename.length < 5 || filename.match(/^index\./)) {
                    const ext = path.extname(filename);
                    const name = path.basename(filename, ext);
                    filename = `${name}-${r.digest.substring(0, 8)}${ext}`;
                }

                if (filename.match(/\.(aspx|asp)$/i)) {
                    filename = filename.replace(/\.(aspx|asp)$/i, '.html');
                }

                const category = Categorizer.categorize(filename, r.original);
                const id = r.digest;

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
    const inventoryPath = options.inventory || 'inventory.json';
    logger.info(`Starting Download Mode from ${inventoryPath}...`);

    if (!await fs.pathExists(inventoryPath)) {
        logger.error(`Inventory file not found: ${inventoryPath}. Run --discover first.`);
        return;
    }

    let inventory: InventoryItem[] = await fs.readJSON(inventoryPath);

    let itemsToProcess = inventory;

    if (options.limit && options.limit > 0) {
        itemsToProcess = itemsToProcess.slice(0, options.limit);
        logger.info(`Limiting downloads to first ${options.limit} items`);
    }

    if (itemsToProcess.length === 0) {
        logger.info('No new items to download.');
        return;
    }

    const dataDir = CONFIG.DATA_DIR;
    const batchSize = CONFIG.CONCURRENT_DOWNLOADS || 5;

    for (let i = 0; i < itemsToProcess.length; i += batchSize) {
        const batch = itemsToProcess.slice(i, i + batchSize);

        await Promise.all(batch.map(async (item) => {
            try {
                // Determine Local Paths
                const yearDir = path.join(dataDir, item.era, item.year.toString());
                const targetDir = path.join(yearDir, item.category);
                await fs.ensureDir(targetDir);
                const targetPath = path.join(targetDir, item.filename);

                // --- 1. Download HTML ---
                let downloaded = false;
                if (await fs.pathExists(targetPath)) {
                    // logger.info(`Skipping main file download (exists): ${targetPath}`);
                    downloaded = true;
                } else {
                    logger.info(`Downloading main file: ${item.originalUrl}`);
                    try {
                        let retries = 0;
                        const maxRetries = 5;
                        let success = false;

                        while (!success && retries < maxRetries) {
                            try {
                                const response = await axios({
                                    url: item.waybackUrl,
                                    method: 'GET',
                                    responseType: 'stream',
                                    timeout: 30000,
                                    validateStatus: (status) => status < 400 || status === 429
                                });

                                if (response.status === 429) {
                                    const delay = Math.pow(2, retries) * 5000 + Math.random() * 1000;
                                    logger.warn(`429 Too Many Requests. Retrying in ${Math.round(delay)}ms...`);
                                    await new Promise(res => setTimeout(res, delay));
                                    retries++;
                                    continue;
                                }

                                const writer = fs.createWriteStream(targetPath);
                                response.data.pipe(writer);
                                await new Promise((resolve, reject) => {
                                    writer.on('finish', resolve);
                                    writer.on('error', reject);
                                });
                                success = true;
                                downloaded = true;

                                // Politeness delay after success
                                await new Promise(res => setTimeout(res, 2000));

                            } catch (reqErr: any) {
                                logger.error(`Request failed: ${reqErr.message}`);
                                retries++;
                                await new Promise(res => setTimeout(res, 2000));
                            }
                        }

                        if (!success) {
                            logger.error(`Failed to download ${item.originalUrl} after ${maxRetries} retries`);
                        }
                    } catch (e: any) {
                        logger.error(`Failed to download ${item.originalUrl}: ${e.message}`);
                    }
                }

                // --- 2. Post-Process (Fill the Holes) ---
                if (downloaded && targetPath.endsWith('.html')) {
                    try {
                        const content = await fs.readFile(targetPath, 'utf-8');
                        const cheerio = require('cheerio');
                        const $ = cheerio.load(content);

                        // Collect assets
                        const assets: { url: string, isImage: boolean }[] = [];

                        $('img').each((_: any, el: any) => {
                            const src = $(el).attr('src');
                            if (src) assets.push({ url: src, isImage: true });
                        });
                        $('link[rel="stylesheet"]').each((_: any, el: any) => {
                            const href = $(el).attr('href');
                            if (href) assets.push({ url: href, isImage: false });
                        });
                        $('script[src]').each((_: any, el: any) => {
                            const src = $(el).attr('src');
                            if (src) assets.push({ url: src, isImage: false });
                        });

                        // Scrape linked documents (PDF, DOC, XLS)
                        $('a[href]').each((_: any, el: any) => {
                            const href = $(el).attr('href');
                            if (href && /\.(pdf|doc|docx|xls|xlsx)$/i.test(href)) {
                                assets.push({ url: href, isImage: false });
                            }
                        });

                        logger.info(`Scanning ${assets.length} potential assets for ${item.filename}`);

                        for (const asset of assets) {
                            if (!asset.url || asset.url.startsWith('data:') || asset.url.startsWith('#') || asset.url.startsWith('mailto:') || asset.url.includes('web.archive.org')) continue;

                            // CLEAN URL
                            let cleanUrl = asset.url.split('?')[0].split('#')[0];

                            // RESOLVE LOCAL PATH
                            let localAssetPath = '';
                            let absoluteOriginalUrl = '';

                            if (cleanUrl.startsWith('/')) {
                                // Root Relative: Map to Year Root? Or Era Root? 
                                // LiftTilYaDie maps / to merged_site root. 
                                // We will map / to Year Root for containment.
                                localAssetPath = path.join(yearDir, cleanUrl.substring(1));
                                // Absolute URL for CDX
                                try {
                                    const u = new URL(item.originalUrl);
                                    absoluteOriginalUrl = `${u.protocol}//${u.host}${cleanUrl}`;
                                } catch (e) { absoluteOriginalUrl = cleanUrl; } // Fallback
                            } else {
                                // Relative: Map to HTML Directory
                                localAssetPath = path.resolve(targetDir, cleanUrl);
                                // Absolute URL for CDX
                                try {
                                    // Construct from base
                                    // We need the directory of the original URL
                                    // original: http://site.com/foo/bar.html
                                    // asset: images/baz.gif -> http://site.com/foo/images/baz.gif
                                    const base = item.originalUrl.substring(0, item.originalUrl.lastIndexOf('/') + 1);
                                    const u = new URL(cleanUrl, base);
                                    absoluteOriginalUrl = u.toString();
                                } catch (e) { absoluteOriginalUrl = cleanUrl; }
                            }

                            // Don't escape the Data Directory!
                            if (!localAssetPath.startsWith(path.resolve(dataDir))) {
                                logger.warn(`Skipping unsafe path: ${localAssetPath}`);
                                continue;
                            }

                            // CHECK EXISTENCE
                            if (await fs.pathExists(localAssetPath)) {
                                // Exists, skip
                                continue;
                            }

                            // DOWNLOAD MISSING ASSET
                            // Logic: 
                            // 1. Try Page-Relative (Current)
                            // 2. If 404/Empty, Try Root-Relative (Fallback) - e.g. /images/...

                            // HELPER: Download from CDX
                            const tryDownload = async (searchUrl: string, destPath: string): Promise<boolean> => {
                                try {
                                    // Strip Port from Search URL for better CDX matching
                                    // http://site.com:80/foo -> http://site.com/foo
                                    const cdxSearchUrl = searchUrl.replace(/:\d+/, '');

                                    logger.info(`[MISSING] Checking CDX: ${cdxSearchUrl} (Window: ${item.timestamp})`);
                                    const cdxUrl = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(cdxSearchUrl)}&closest=${item.timestamp}&limit=1&output=json&filter=statuscode:200`;

                                    const cdxRes = await axios.get(cdxUrl, { timeout: 30000, validateStatus: () => true });

                                    if (cdxRes.status === 200 && cdxRes.data && cdxRes.data.length > 1) {
                                        const row = cdxRes.data[1];
                                        const ts = row[1];
                                        const original = row[2]; // Use original because sometimes it redirects?
                                        const dlUrl = `http://web.archive.org/web/${ts}id_/${original}`;

                                        logger.info(`  -> Found Snapshot: ${ts} | Downloading...`);

                                        const assetRes = await axios({
                                            url: dlUrl,
                                            method: 'GET',
                                            responseType: 'arraybuffer',
                                            timeout: 60000,
                                            headers: { 'User-Agent': 'Mozilla/5.0' },
                                            validateStatus: (status) => status < 400
                                        });

                                        const type = assetRes.headers['content-type'] || '';
                                        if (asset.isImage && type.includes('text/html')) {
                                            logger.warn(`  -> REJECTED: Corrupt HTML in image`);
                                            return false;
                                        } else {
                                            await fs.ensureDir(path.dirname(destPath));
                                            await fs.writeFile(destPath, assetRes.data);
                                            logger.info(`  -> SAVED: ${destPath}`);
                                            return true;
                                        }
                                    }
                                } catch (e: any) {
                                    logger.warn(`  -> CDX Error: ${e.message}`);
                                }
                                return false;
                            };

                            let success = await tryDownload(absoluteOriginalUrl, localAssetPath);

                            // FALLBACK: If failed and looking for image, try /images root
                            // Only if cleanUrl is relative (not starting with /)
                            if (!success && !cleanUrl.startsWith('/') && asset.isImage) {
                                // Construct root fallback URL
                                // original: http://site.com/foo/bar.aspx
                                // asset: images/baz.gif
                                // fallback: http://site.com/images/baz.gif
                                try {
                                    const u = new URL(item.originalUrl);
                                    const rootFallbackUrl = `${u.protocol}//${u.host}/${cleanUrl}`;
                                    logger.info(`  -> Fallback: Trying Root URL ${rootFallbackUrl}`);
                                    // We save it to the SAME local path to keep HTML valid
                                    success = await tryDownload(rootFallbackUrl, localAssetPath);
                                } catch (e) { }
                            }

                            if (!success) {
                                logger.info(`  -> Failed to recover asset.`);
                            }
                        }
                    } catch (err) {
                        logger.warn(`Failed to process assets for ${targetPath}: ${err}`);
                    }
                }

                item.status = 'downloaded';
                item.localPath = targetPath;
                logger.info(`Completed: ${item.filename}`);

            } catch (err: any) {
                logger.error(`Failed ${item.originalUrl}: ${err.message}`);
                item.status = 'failed';
            }
        }));
    }
}

async function runFullCycle(options: any) {
    await runDiscovery(options);
    await runDownload(options);
}

main().catch(err => {
    logger.error(err, 'Unhandled exception in main loop');
    process.exit(1);
});
