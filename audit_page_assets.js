const fs = require('fs-extra');
const path = require('path');

const htmlFile = path.join(__dirname, 'data', 'msbn', '2005', 'uncategorized', 'eventDetails-EJE2E4EC.html');
const assetsDir = path.join(__dirname, 'data', 'msbn', 'assets'); // Unused mostly now but kept for reference

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
            if (!src || src.startsWith('data:') || src.startsWith('#') || src.startsWith('http') || src.startsWith('mailto:')) {
                console.log(`[SKIP] External/Data: ${src}`);
                continue;
            }

            // JOIN PATH relative to HTML file
            // HTML File: data/msbn/2005/uncategorized/eventDetails-EJE2E4EC.html
            // Src: images/spacer.gif
            // Expected: data/msbn/2005/uncategorized/images/spacer.gif

            let localPath;
            if (src.startsWith('/')) {
                // Root relative - strictly speaking this maps to domain root
                // For this test, we assume we mapped / to the year root?
                // Logic in index.ts: localAssetPath = path.join(yearDir, cleanUrl.substring(1));
                // let's try to verify that logic:
                // We need yearDir. 
                // HTML is in .../2005/uncategorized/...
                // Root is .../2005/
                const yearDir = path.resolve(path.dirname(htmlFile), '..');
                localPath = path.join(yearDir, src.substring(1));
            } else {
                localPath = path.resolve(path.dirname(htmlFile), src);
            }

            try {
                const stats = await fs.stat(localPath);
                if (stats.size === 0) {
                    console.log(`[FAIL] ${src} -> ${localPath}: 0 bytes (EMPTY)`);
                    failures++;
                } else if (stats.size < 100) {
                    console.log(`[WARN] ${src} -> ${localPath}: ${stats.size} bytes (SUSPICIOUSLY SMALL)`);
                } else {
                    console.log(`[PASS] ${src} -> ${localPath}: ${stats.size} bytes`);
                }
            } catch (e) {
                console.log(`[FAIL] ${src} -> ${localPath}: MISSING locally.`);
                failures++;
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
