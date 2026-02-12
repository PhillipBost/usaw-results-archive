export interface EraConfig {
    id: string;
    description: string;
    targets: string[];
    startYear: number;
    endYear: number;
}

export const ERAS: Record<string, EraConfig> = {
    'early-web': {
        id: 'early-web',
        description: 'Early Web (2000-2004)',
        targets: ['usaweightlifting.org', '*.usaweightlifting.org'],
        startYear: 2000,
        endYear: 2004
    },
    'msbn': {
        id: 'msbn',
        description: 'MSBN Era (2004-2008)',
        targets: ['msbn.tv/usavision'],
        startYear: 2004,
        endYear: 2008
    },
    'hangastar': {
        id: 'hangastar',
        description: 'Hangastar Era (2008-2015)',
        targets: ['weightlifting.teamusa.org', 'assets.teamusa.org'],
        startYear: 2008,
        endYear: 2015
    }
};

export const CONFIG = {
    // Legacy support (will be replaced by Era logic logic in main execution if era is selected)
    SEARCH_TARGETS: [
        'usaweightlifting.org',
        '*.usaweightlifting.org',
        'msbn.tv/usavision',
        'weightlifting.teamusa.org',
    ],
    TARGET_EXTENSIONS: ['.pdf', '.xls', '.xlsx', '.doc', '.docx', '.html', '.htm'],
    TARGET_MIME_TYPES: [
        'text/html',
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    CDX_API_URL: 'http://web.archive.org/cdx/search/cdx',
    DATA_DIR: './data',
    CONCURRENT_DOWNLOADS: 5,
};
