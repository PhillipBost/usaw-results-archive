export const CONFIG = {
    // CDX API handles domain/* automatically if we pass just domain, but we want control
    // We will iterate these and add /* if it looks like a domain, or use the path if specified
    SEARCH_TARGETS: [
        'usaweightlifting.org',
        '*.usaweightlifting.org',
        'msbn.tv/usavision',
        'weightlifting.teamusa.org',
        // 'assets.teamusa.org/assets/documents' // This might be huge, let's be careful or add specific filter logic
    ],
    // Broad filter: include various document types
    TARGET_EXTENSIONS: ['.pdf', '.xls', '.xlsx', '.doc', '.docx', '.html', '.htm'],
    // Mime types to filter for in CDX - keeping it broad as per user request
    TARGET_MIME_TYPES: [
        'text/html', // Added to capture HTML results pages
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // 'text/html' // explicitly excluding HTML to focus on documents
    ],
    CDX_API_URL: 'http://web.archive.org/cdx/search/cdx',
    DATA_DIR: './data',
    CONCURRENT_DOWNLOADS: 5,
};
