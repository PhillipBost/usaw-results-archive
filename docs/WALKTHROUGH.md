# USAW Results Archive Scraper - Walkthrough

## Overview
This project scrapes historical USA Weightlifting documents from the Wayback Machine across three main eras:
1.  **Early Web (2000-2004)**: `usaweightlifting.org` (HTML results)
2.  **MSBN TV (2004-2008)**: `msbn.tv/usavision` (ASPX pages converted to HTML)
3.  **Hang A Star (2008-2011)**: `weightlifting.teamusa.org` (PDFs and results)

## Key Features
-   **Offline Archiving**: All HTML pages are saved with their images and CSS downloaded locally.
    -   Assets are stored in `data/{Era}/assets` to avoid duplication.
    -   HTML links are rewritten to point to these local files (e.g., `../../assets/image.gif`).
    -   **No internet connection required** to view the archive once downloaded.
-   **Original Look & Feel**: Preserves the original 2005-era design by capturing the original capabilities.
-   **Smart Inventory**: Tracks files to avoid re-downloading.
-   **Dynamic Content Capture**: Captures multiple versions of the same page (e.g., `displaypage.aspx?id=410`) if the content changed over time.
-   **Clean Organization**: `data/{Era}/{Year}/{Category}/{Filename}`.

## Setup
1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Build**:
    ```bash
    npm run build
    ```
    (Or just run via `node dist/index.js`)

## Usage

### 1. Discovery
First, build an inventory of what exists in the Wayback Machine headers (CDX API).
```bash
# Discover MSBN era (2004-2008)
node dist/index.js --discover --era msbn

# Discover limited number (testing)
node dist/index.js --discover --era msbn --limit 10
```
This generates `inventory.json`.

### 2. Download
Download the files listed in `inventory.json`. This step also downloads all referenced assets (images/CSS) and rewrites the HTML for offline viewing.
```bash
node dist/index.js --download
```

### 3. Viewing
Navigate to the `data/` folder and open any `.html` file in your browser. It will load instantly with all images because they are on your disk.

## Directory Structure
```
data/
├── msbn/
│   ├── assets/              # Shared images/css for this era
│   │   ├── a1b2c3d4.gif
│   │   └── ...
│   ├── 2005/
│   │   ├── results/
│   │   └── some-meet.html   # Points to ../../assets/a1b2c3d4.gif
│   └── 2006/
├── inventory.json           # Tracks status
└── ...
```
