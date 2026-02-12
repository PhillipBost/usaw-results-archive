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

    async search(target: string): Promise<CdxResult[]> {
        // Ensure valid CDX match type. 
        // If target has no path, assume domain wildcard.
        // If target has path, we still want matchType=prefix usually, or just end with *

        let urlPattern = target;
        if (!urlPattern.endsWith('*')) {
            urlPattern = `${urlPattern}/*`;
        }

        const params = {
            url: urlPattern,
            output: 'json',
            fl: 'urlkey,timestamp,original,mimetype,statuscode,digest,length',
            collapse: 'digest', // Collapse by digest to avoid duplicates
            filter: [
                'statuscode:200',
                // We can't easily OR filters in CDX API 1-param filter, so we might need multiple queries or client-side filtering
                // But let's try to match mime types. 
                // Actually, CDX API 'filter' param supports regex!
                // filter: `mimetype:(${CONFIG.TARGET_MIME_TYPES.join('|')})` -> verify if this syntax works, standard is usually just one field.
                // It's safer to filter by !mimetype:text/html or similar, or just fetch all 200s and filter client side if volume isn't massive.
                // Given 'usaweightlifting.org' history isn't petabytes, fetching all 200s and filtering client-side for extensions/mimes is safer/more robust.
            ],
        };

        try {
            // We will do a broad search for status 200 and filter client side to ensure we don't miss anything due to funky mime types
            console.log(`CDX Request: ${this.baseUrl} with params:`, JSON.stringify({ ...params, filter: 'statuscode:200' }, null, 2));
            const response = await axios.get(this.baseUrl, {
                params: {
                    ...params,
                    filter: 'statuscode:200'
                }
            });

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

                console.log(`[DEBUG] Raw CDX results before filtering: ${results.length}`);
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
                    // User mentioned specific paths like /results.html, /localeventresults.html, /results/*.htm
                    // So let's keep it if it has 'result' in path OR if it matches known patterns.
                    // For now, let's just log and keep reasonable ones? 
                    // Actually, scraping *every* HTML page is bad.
                    return false;
                }
            }

            return true;
        });
    }
}
