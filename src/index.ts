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

                    if (await fs.pathExists(targetPath)) {
                        logger.info(`Skipping existing: ${targetPath}`);
                        item.status = 'downloaded';
                        item.localPath = targetPath;
                        return;
                    }

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

                    // Post-process HTML files to improve readability (inject basic CSS)
                    if (targetPath.endsWith('.html')) {
                        try {
                            const content = await fs.readFile(targetPath, 'utf-8');
                            // Check if it already has our style or just append to head/body
                            // Offline Asset Archiving
                            // 1. Create assets directory for this Era
                            const assetsDir = path.join(dataDir, item.era, 'assets');
                            await fs.ensureDir(assetsDir);

                            const timestamp = item.timestamp;
                            const waybackPrefix = `http://web.archive.org/web/${timestamp}`;
                            const waybackImgPrefix = `http://web.archive.org/web/${timestamp}im_`;

                            // Helper to resolve relative paths to absolute Wayback URLs
                            const resolveUrl = (rel: string) => {
                                if (rel.startsWith('http')) return rel;
                                try {
                                    return new URL(rel, item.originalUrl).toString();
                                } catch (e) { return rel; }
                            };

                            // Helper to download asset
                            const downloadAsset = async (url: string, isImage: boolean): Promise<string | null> => {
                                try {
                                    // Construct Wayback URL
                                    let assetWaybackUrl = url;
                                    if (!url.startsWith('http')) {
                                        // It's likely a relative path we need to resolve against the original URL, then prefix
                                        const absOriginal = resolveUrl(url);
                                        // If it's an image, use im_ modifer, else standard
                                        const prefix = isImage ? waybackImgPrefix : waybackPrefix;
                                        // The prefix often already includes the http part of the target if we simply concat, 
                                        // but Wayback URL structure is `http://web.archive.org/web/TIMESTAMP/TARGET_URL`
                                        // If we resolved `absOriginal` it is `http://target.com/img.jpg`
                                        // So we need: `http://web.archive.org/web/TIMESTAMPim_/http://target.com/img.jpg`
                                        assetWaybackUrl = `${prefix}/${absOriginal}`;
                                    } else if (!url.includes('web.archive.org')) {
                                        // Absolute url but not pointing to wayback?
                                        const prefix = isImage ? waybackImgPrefix : waybackPrefix;
                                        assetWaybackUrl = `${prefix}/${url}`;
                                    }

                                    // Generate local filename (MD5 of the full Wayback URL to ensure uniqueness per version)
                                    // Actually, MD5 of the *original* asset URL is better for deduplication across different timestamps if the asset hasn't changed?
                                    // But we are downloading from a specific timestamp. Let's use the resulting local filename based on the Asset's URL.
                                    // Let's use crypto to hash the Asset URL.
                                    const crypto = require('crypto');
                                    const hash = crypto.createHash('md5').update(assetWaybackUrl).digest('hex');
                                    const ext = path.extname(url.split('?')[0]) || (isImage ? '.jpg' : '.css');
                                    const localFilename = `${hash}${ext}`;
                                    const localPath = path.join(assetsDir, localFilename);

                                    // Download if not exists
                                    if (!await fs.pathExists(localPath)) {
                                        // logger.info(`Downloading asset: ${assetWaybackUrl}`);
                                        const response = await require('axios')({
                                            url: assetWaybackUrl,
                                            method: 'GET',
                                            responseType: 'arraybuffer', // generic for both images and text
                                            timeout: 10000,
                                        });
                                        await fs.writeFile(localPath, response.data);
                                    }

                                    // Return relative path from the HTML file to the asset
                                    // HTML is in data/{Era}/{Year}/{Category}/
                                    // Assets are in data/{Era}/assets/
                                    // So we need to go up 2 levels: ../../assets/
                                    // Wait, data/Era/Year/Category -> .. (Year) -> .. (Era) -> assets. That's ../../assets
                                    return `../../assets/${localFilename}`;

                                } catch (e: any) {
                                    // logger.debug(`Failed to download asset ${url}: ${e.message}`);
                                    return null;
                                }
                            };


                            // Regex to find src="..." and href="..."
                            // We need to replace them asynchronously, which replace() doesn't support well with async callbacks.
                            // So we find all matches first, process them, then replace.

                            let matches: { full: string, quote: string, url: string, isImage: boolean, index: number }[] = [];

                            // Find images (src)
                            let srcRegex = /(src=["'])(.*?)(["'])/gi;
                            let match;
                            while ((match = srcRegex.exec(content)) !== null) {
                                matches.push({ full: match[0], quote: match[1], url: match[2], isImage: true, index: match.index });
                            }

                            // Find CSS (href) - exclude anchors/canonical/etc if possible, but basic href is usually css in head
                            // We should be careful not to rewrite <a href> links to pages as assets.
                            // CSS usually in <link href="...">
                            let linkRegex = /(<link[^>]*href=["'])(.*?)(["'])/gi;
                            while ((match = linkRegex.exec(content)) !== null) {
                                matches.push({ full: match[0], quote: match[1], url: match[2], isImage: false, index: match.index });
                            }

                            // Also checks for images in style attributes? Too complex for now.

                            // Process matches (in parallelish)
                            // We sort matches by index descending to replace without messing up offsets? 
                            // Actually simply replacing the exact string is risky if duplicates.
                            // Let's just build a map of replacements.

                            const replacements = new Map<string, string>();

                            for (const m of matches) {
                                if (m.url.startsWith('data:') || m.url.startsWith('#') || m.url.startsWith('mailto:')) continue;

                                // Avoid re-downloading same url multiple times in this loop
                                if (!replacements.has(m.url)) {
                                    const localLink = await downloadAsset(m.url, m.isImage);
                                    if (localLink) {
                                        replacements.set(m.url, localLink);
                                    }
                                }
                            }

                            // Apply replacements
                            // We iterate again to ensure we don't double replace logic
                            // Or stricter: Replace specific substrings. 

                            let newContent = content; // Start with original content

                            // Sort replacements by length descending to avoid substring collision (e.g. replacing 'spacer.gif' inside 'images/spacer.gif')
                            const sortedReplacements = Array.from(replacements.entries()).sort((a, b) => b[0].length - a[0].length);

                            for (const [originalUrl, localLink] of sortedReplacements) {
                                // Escaping for regex replace is messy. 
                                // Let's use split/join which is global replace for literal string
                                newContent = newContent.split(originalUrl).join(localLink);
                            }

                            await fs.writeFile(targetPath, newContent);
                        } catch (err) {
                            logger.warn(`Failed to process assets for ${targetPath}: ${err}`);
                        }
                    }

                    item.status = 'downloaded';
                    item.localPath = targetPath;
                    logger.info(`Downloaded: ${targetPath}`);
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
