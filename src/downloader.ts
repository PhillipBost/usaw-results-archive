import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { CONFIG } from './config';
import { CdxResult } from './cdx';
import * as crypto from 'crypto';

export class Downloader {
    private dataDir = CONFIG.DATA_DIR;

    constructor() {
        fs.ensureDirSync(this.dataDir);
    }

    async downloadFile(result: CdxResult): Promise<void> {
        const waybackUrl = `http://web.archive.org/web/${result.timestamp}id_/${result.original}`;

        // Parse timestamp to get year
        const year = result.timestamp.substring(0, 4);

        // Extract filename from URL
        let filename = path.basename(result.original);
        // Remove query parameters if present
        filename = filename.split('?')[0];

        // If filename is empty or too generic, use a hash or timestamp
        if (!filename || filename.length < 3) {
            filename = `${result.timestamp}-${crypto.createHash('md5').update(result.original).digest('hex').substring(0, 8)}.file`;
        }

        // Create directory: data/year/
        const targetDir = path.join(this.dataDir, year);
        await fs.ensureDir(targetDir);

        const filePath = path.join(targetDir, filename);

        // Check if file exists and has same size (loose check)
        if (await fs.pathExists(filePath)) {
            console.log(`Skipping existing file: ${filePath}`);
            return;
        }

        console.log(`Downloading: ${result.original} -> ${filePath}`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await axios({
                    url: waybackUrl,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 60000, // Increased timeout to 60s
                });

                const writer = fs.createWriteStream(filePath);
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                return; // Success
            } catch (error: any) {
                console.error(`Failed to download ${result.original} (Attempt ${attempt}/3): ${error.message}`);

                // Clean up partial file
                if (await fs.pathExists(filePath)) {
                    await fs.unlink(filePath).catch(() => { });
                }

                if (attempt < 3) {
                    const delay = 2000 * Math.pow(2, attempt); // 4s, 8s, 16s
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
    }
}
