import { Command } from 'commander';
import { CdxClient } from './cdx';
import { Downloader } from './downloader';
import { CONFIG } from './config';
import pino from 'pino';

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
    .option('-d, --dry-run', 'simulate downloads without writing files')
    .option('-l, --limit <number>', 'limit the number of files to download per domain', parseInt)
    .parse(process.argv);

async function main() {
    const options = program.opts();

    logger.info('Starting USAW Results Archive Scraper...');
    if (options.dryRun) logger.info('Running in DRY-RUN mode');
    if (options.limit) logger.info(`Limiting to ${options.limit} files per domain`);

    const cdxClient = new CdxClient();
    const downloader = new Downloader();

    for (const target of CONFIG.SEARCH_TARGETS) {
        logger.info(`Searching CDX for target: ${target}`);
        try {
            const results = await cdxClient.search(target);
            logger.info(`Found ${results.length} total matching documents for ${target}`);

            let filesToProcess = results;
            if (options.limit && options.limit > 0) {
                filesToProcess = results.slice(0, options.limit);
                logger.info(`Limiting processing to first ${options.limit} files`);
            }

            // Process in batches
            const batchSize = CONFIG.CONCURRENT_DOWNLOADS || 5;
            for (let i = 0; i < filesToProcess.length; i += batchSize) {
                const batch = filesToProcess.slice(i, i + batchSize);

                if (options.dryRun) {
                    batch.forEach(result => {
                        logger.info(`[DRY-RUN] Would download: ${result.original} (${result.timestamp})`);
                    });
                } else {
                    await Promise.all(batch.map(result => downloader.downloadFile(result)));
                }

                logger.info(`Processed ${Math.min(i + batchSize, filesToProcess.length)}/${filesToProcess.length}`);
            }

        } catch (error) {
            logger.error(error, `Error processing target ${target}`);
        }
    }

    logger.info('Scraping complete.');
}

main().catch(err => {
    logger.error(err, 'Unhandled exception in main loop');
    process.exit(1);
});
