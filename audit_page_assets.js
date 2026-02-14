const fs = require('fs-extra');
const path = require('path');

const htmlFile = path.join(__dirname, 'data', 'msbn', '2006', 'uncategorized', 'eventDetails-7IKMLLYP.html');
const assetsDir = path.join(__dirname, 'data', 'msbn', 'assets');

async function audit() {
    console.log(`Auditing: ${htmlFile}`);
    try {
        const html = await fs.readFile(htmlFile, 'utf8');

        // Regex to find all src attributes
        const srcRegex = /src=["']([^"']+)["']/g;
        let match;
        const assets = new Set();

        while ((match = srcRegex.exec(html)) !== null) {
            assets.add(match[1]);
        }

        console.log(`Found ${assets.size} unique src attributes.`);

        let failures = 0;

        for (const src of assets) {
            // Check if it's an asset in our assets dir
            if (src.includes('assets/')) {
                const filename = src.split('assets/')[1];
                const localPath = path.join(assetsDir, filename);

                try {
                    const stats = await fs.stat(localPath);
                    if (stats.size === 0) {
                        console.log(`[FAIL] ${filename}: 0 bytes (EMPTY)`);
                        failures++;
                    } else if (stats.size < 100) {
                        console.log(`[WARN] ${filename}: ${stats.size} bytes (SUSPICIOUSLY SMALL)`);
                    } else {
                        console.log(`[PASS] ${filename}: ${stats.size} bytes`);
                    }
                } catch (e) {
                    console.log(`[FAIL] ${filename}: MISSING locally.`);
                    failures++;
                }
            } else {
                console.log(`[INFO] External/Other src: ${src}`);
            }
        }

        if (failures > 0) {
            console.log(`\nAudit FAILED: ${failures} broken assets found.`);
            process.exit(1);
        } else {
            console.log(`\nAudit PASSED: All assets present and valid.`);
        }

    } catch (e) {
        console.error('Error reading HTML:', e);
    }
}

audit();
