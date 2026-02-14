const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

// Setup
const assetsDir = path.join(__dirname, 'data', 'msbn', 'assets');
const logger = {
    info: (msg) => console.log('INFO:', msg),
    warn: (msg) => console.warn('WARN:', msg),
    error: (msg) => console.error('ERROR:', msg)
};

// Mock item for timestamp context
const item = { timestamp: '20060504' };

// The problematic URL
const assetUrl = 'http://www.msbn.tv/usavision/networks/USAVision/menu/menu.css';
const isImage = false;

// Helpers
const waybackPrefix = 'http://web.archive.org/web';

async function main() {
    await fs.ensureDir(assetsDir);

    console.log('Starting debug download...');

    // --- Pasting the relevant logic from index.ts ---

    const downloadAsset = async (url, isImage) => {
        if (!url) return null;
        let cleanUrl = url;

        logger.info(`Attempting download for asset: ${cleanUrl}`);
        try {
            // Step 1: Resolve to absolute URL if needed (skip since we provided absolute)
            let absoluteUrl = cleanUrl;

            // Step 2: Construct Wayback URL
            const prefix = waybackPrefix;
            // Simplified construction for debug
            const assetWaybackUrl = `http://web.archive.org/web/${item.timestamp}id_/${absoluteUrl}`;
            logger.info(`  Constructed Wayback URL: ${assetWaybackUrl}`);

            // Generate local filename
            const hash = crypto.createHash('md5').update(assetWaybackUrl).digest('hex');
            const ext = '.css';
            const localFilename = `${hash}${ext}`;
            const localPath = path.join(assetsDir, localFilename);

            console.log(`  Target local path: ${localPath}`);

            // Recursive function to handle Wayback redirects
            const fetchWayback = async (url, retries = 3) => {
                try {
                    console.log(`  Fetching: ${url}`);
                    const res = await axios({
                        url: url,
                        method: 'GET',
                        responseType: 'arraybuffer',
                        timeout: 30000,
                        maxRedirects: 0,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        validateStatus: (status) => status < 400
                    });

                    // Handle Redirects (3xx)
                    if (res.status >= 300 && res.status < 400) {
                        const location = res.headers.location || res.headers.Location;
                        if (location) {
                            logger.info(`  Handling Wayback redirect ${res.status} to: ${location}`);

                            if (location.includes('web.archive.org/web/')) {
                                if (retries > 0) return fetchWayback(location, retries - 1);
                                return null;
                            }

                            // Rewrite logic
                            const tsMatch = url.match(/\/web\/(\d{14})id_\//);
                            const timestamp = tsMatch ? tsMatch[1] : item.timestamp;

                            let targetUrl = location;
                            if (!location.startsWith('http')) {
                                try {
                                    const baseUrl = url.split('id_/')[1];
                                    if (baseUrl) {
                                        targetUrl = new URL(location, baseUrl).toString();
                                    }
                                } catch (e) { }
                            }

                            const waybackRedirectUrl = `http://web.archive.org/web/${timestamp}id_/${targetUrl}`;
                            logger.info(`  Rewrote redirect to Wayback: ${waybackRedirectUrl}`);

                            if (retries > 0) return fetchWayback(waybackRedirectUrl, retries - 1);
                        }
                        return null;
                    }
                    return res;
                } catch (e) {
                    console.log(`  Fetch error: ${e.message}`);
                    throw e;
                }
            };

            try {
                let response = await fetchWayback(assetWaybackUrl);

                // Fallback: CDX logic
                if (!response || (response.status === 200 && (!response.data || response.data.length === 0))) {
                    logger.warn(`Primary download failed/empty. Attempting CDX lookup...`);

                    try {
                        const originalUrl = cleanUrl;
                        const timestamp = '20060101'; // approximate
                        const cdxUrl = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(originalUrl)}&output=json&limit=1&closest=${timestamp}`;

                        logger.info(`  Querying CDX: ${cdxUrl}`);
                        const cdxRes = await axios.get(cdxUrl, { timeout: 15000 });

                        if (cdxRes.status === 200 && cdxRes.data && cdxRes.data.length > 1) {
                            const row = cdxRes.data[1];
                            const ts = row[1];
                            const directUrl = `http://web.archive.org/web/${ts}id_/${originalUrl}`;
                            logger.info(`  CDX found snapshot: ${directUrl}`);

                            response = await fetchWayback(directUrl);
                        }
                    } catch (cdxErr) {
                        logger.warn(`  CDX lookup failed: ${cdxErr.message}`);
                    }
                }

                if (response && response.status === 200 && response.data && response.data.length > 0) {
                    await fs.writeFile(localPath, response.data);
                    logger.info(`  Downloaded asset: ${cleanUrl} (${response.data.length} bytes)`);
                    return localFilename;
                } else {
                    logger.warn(`  Still failed/empty.`);
                    return null;
                }
            } catch (e) {
                logger.warn(`Failed to download asset: ${e.message}`);
                return null;
            }
        } catch (e) {
            console.error('Fatal error in downloadAsset:', e);
        }
    };

    await downloadAsset(assetUrl, isImage);
}

main().catch(console.error);
