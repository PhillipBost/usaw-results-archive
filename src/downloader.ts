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
        // CdxResult 'length' is string, usually bytes
        if (await fs.pathExists(filePath)) {
            // Optional: strict check with hash if we had it in CDX (digest is there but format varies)
            // For now, skip if exists to save bandwidth
            console.log(`Skipping existing file: ${filePath}`);
            return;
        }

        console.log(`Downloading: ${result.original} -> ${filePath}`);

        try {
            const response = await axios({
                url: waybackUrl,
                method: 'GET',
                responseType: 'stream',
                timeout: 30000, // 30s timeout
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        } catch (error: any) {
            console.error(`Failed to download ${result.original}: ${error.message}`);
            // Don't throw, just log. We want to continue with other files.
        }
    }
}
