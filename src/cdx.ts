import axios from 'axios';
import { CONFIG } from './config';

export interface CdxResult {
    urlkey: string;
    timestamp: string;
    original: string;
    mimetype: string;
    statuscode: string;
    digest: string;
    length: string;
}

export class CdxClient {
    private baseUrl = CONFIG.CDX_API_URL;

    async search(target: string, options?: { from?: number; to?: number }): Promise<CdxResult[]> {
        // Ensure valid CDX match type. 
        // If target has no path, assume domain wildcard.
        // If target has path, we still want matchType=prefix usually, or just end with *

        let urlPattern = target;
        if (!urlPattern.endsWith('*')) {
            urlPattern = `${urlPattern}/*`;
        }

        const params: any = {
            url: urlPattern,
            output: 'json',
            fl: 'urlkey,timestamp,original,mimetype,statuscode,digest,length',
            collapse: 'digest', // Collapse by digest to avoid duplicates
            filter: [
                'statuscode:200',
            ],
        };

        if (options?.from) params.from = options.from.toString();
        if (options?.to) params.to = options.to.toString();

        try {
            // We will do a broad search for status 200 and filter client side to ensure we don't miss anything due to funky mime types
            // console.log(`CDX Request: ${this.baseUrl} with params:`, JSON.stringify({ ...params, filter: 'statuscode:200' }, null, 2));

            let response: any;
            let retries = 0;
            const maxRetries = 5;
            let success = false;

            while (!success && retries < maxRetries) {
                try {
                    response = await axios.get(this.baseUrl, {
                        params: {
                            ...params,
                            filter: 'statuscode:200'
                        },
                        validateStatus: (status) => status < 400 || status === 429
                    });

                    if (response.status === 429) {
                        const delay = Math.pow(2, retries) * 5000 + Math.random() * 1000;
                        console.warn(`[CDX] 429 Too Many Requests. Retrying in ${Math.round(delay)}ms...`);
                        await new Promise(res => setTimeout(res, delay));
                        retries++;
                        continue;
                    }

                    success = true;
                    // Politeness delay after success
                    await new Promise(res => setTimeout(res, 1000));

                } catch (error: any) {
                    console.error(`CDX Request failed: ${error.message}`);
                    retries++;
                    await new Promise(res => setTimeout(res, 2000));
                }
            }

            if (!success || !response) {
                throw new Error(`Failed to fetch from CDX after ${maxRetries} retries`);
            }

            if (response.data && Array.isArray(response.data)) {
                // First element is the header: ["urlkey", "timestamp", ...]
                const header = response.data[0];
                const rows = response.data.slice(1);

                const results = rows.map((row: string[]) => {
                    const result: any = {};
                    header.forEach((key: string, index: number) => {
                        result[key] = row[index];
                    });
                    return result as CdxResult;
                });

                // console.log(`[DEBUG] Raw CDX results before filtering: ${results.length}`);
                return this.filterResults(results);
            }
            return [];
        } catch (error) {
            console.error(`Error searching CDX for ${target}:`, error);
            throw error;
        }
    }

    private filterResults(results: CdxResult[]): CdxResult[] {
        return results.filter(r => {
            // 1. Mime type check
            const validMime = CONFIG.TARGET_MIME_TYPES.some(mime => r.mimetype.includes(mime));

            // 2. Extension check (fallback if mime is generic 'application/octet-stream' but URL ends in .pdf)
            const hasExtension = CONFIG.TARGET_EXTENSIONS.some(ext => r.original.toLowerCase().endsWith(ext));

            if (!validMime && !hasExtension) return false;

            // Refinement: If it's HTML, only keep it if it looks like a result page
            if (r.mimetype.includes('text/html') || r.original.endsWith('.html') || r.original.endsWith('.htm')) {
                const lowerUrl = r.original.toLowerCase();
                // Basic keywords common in result URLs
                if (!lowerUrl.includes('result') && !lowerUrl.includes('event') && !lowerUrl.includes('meet')) {
                    // Only skip if we are strictly looking for results. 
                    return false;
                }
            }

            return true;
        });
    }
}
