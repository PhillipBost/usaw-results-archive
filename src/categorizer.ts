export type FileCategory = 'results' | 'event_info' | 'governance' | 'uncategorized';

export class Categorizer {
    static categorize(filename: string, originalUrl: string): FileCategory {
        const lowerName = filename.toLowerCase();
        const lowerUrl = originalUrl.toLowerCase();

        // Check keywords in both filename and url
        const textToCheck = `${lowerName} ${lowerUrl}`;

        // 1. Results (Highest Priority)
        if (textToCheck.includes('result')) {
            return 'results';
        }

        // 2. Governance
        if (textToCheck.includes('minute') || textToCheck.includes('bylaw') || textToCheck.includes('board')) {
            return 'governance';
        }

        // 3. Event Info
        // User explicitly rejected 'qual', 'prospectus', 'meet' (too broad)
        if (textToCheck.includes('entry') || textToCheck.includes('form') || textToCheck.includes('packet') || textToCheck.includes('schedule')) {
            return 'event_info';
        }

        return 'uncategorized';
    }
}
