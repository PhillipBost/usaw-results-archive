# USAW Results Archive Scraper - Walkthrough

## Overview

This project scrapes historical USA Weightlifting documents from the Wayback Machine across three main eras:

- **Early Web (1998-2004)**: `usaweightlifting.org` (HTML results)
- **MSBN TV (2004-2008)**: `msbn.tv/usavision` (ASPX pages converted to HTML)
- **Hang A Star (2008-2015)**: `weightlifting.teamusa.org` (PDFs and results)

## Key Features

- **Offline Archiving**: All HTML pages are saved with their images and CSS downloaded locally.
  - Assets are stored in `data/{Era}/assets` to avoid duplication.
  - HTML links are rewritten to point to these local files (e.g., `../../assets/image.gif`).
  - **No internet connection required** to view the archive once downloaded.
- **Original Look & Feel**: Preserves the original 2005-era design by capturing the original capabilities.
- **Smart Inventory**: Tracks files to avoid re-downloading.
- **Dynamic Content Capture**: Captures multiple versions of the same page (e.g., `displaypage.aspx?id=410`) if the content changed over time.
- **Clean Organization**: `data/{Era}/{Year}/{Category}/{Filename}`.

## Setup

1. **Install Dependencies**:

    ```bash
    npm install
    ```

2. **Build**:

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

## Major Recovery Phases

### Phase 4: Early Web Deep Scrape (1998–2004)

Successfully performed a recursive deep scrape of the early `usaweightlifting.org` index pages. This captured **291 nested assets** (results, missions, and frame content) that were buried on secondary pages and missing from top-level discovery. All assets are now integrated into the unified inventory and organized by year.

### Phase 5: Filename Normalization & Cleanup

Successfully renamed 6 files with percent-encoded characters (e.g., `May%202007.pdf` -> `May 2007.pdf`) and patched all downloaders to ensure clean filenames moving forward. Corrected the unified inventory to map these normalized names back to their original source URLs.

### Phase 6: MSBN Exhaustion & "Invisible" Asset Recovery

Identified a discrepancy in Wayback Machine's Web UI where directory searches (e.g., `.../pdf/*`) are non-exhaustive. By switching to direct CDX API prefix searches, we re-discovered **84 unique high-value assets** (including `AUGUST2004.pdf`) that were previously missed. These are now fully downloaded and integrated into the `msbn` era of the unified inventory.

### Phase 7: Hangastar Long-Tail (2008–2015)

[COMPLETED] Successfully archived **5,798 total assets** from the Hangastar era.

- **Priority Loading**: Captured 100% of meet results, newsletters, and rankings.
- **Long-Tail Coverage**: Captured over 4,300 additional administrative/technical documents.
- **Unified Integration**: All files are now 100% cataloged and offline-accessible.

### Phase 8: AAU Junior Olympic Games (1992–2015)

[COMPLETED] Successfully separated AAU into its own dedicated era and performed an exhaustive recovery.

- **Exhaustive Discovery**: Captured **71 unique weightlifting assets** across multiple domain variants (`www.aaujrogames.org` and `aaujrogames.org`).
- **Critical Recovery**: Verified the recovery of the **1992 Weightlifting.pdf** and fixed the mis-sorting of 1997 results.
- **Physical Organization**: Organized into a clean `data/aau/[YEAR]/results` hierarchy.

### Phase 9: Ohio LWC Recovery (2010–2015)

[COMPLETED] Expanded the OHLWC archive to include **299 total assets**.

- **Redirect Recovery**: Successfully captured PDF and document results redirected from Google Sites to Google Groups attachments.
- **Unified Integration**: All local/state results are now fully cataloged in the `ohlwc` era.

### Phase 10: USA National Masters Newsletters (1970s)

[COMPLETED] Leveraged a browser subagent and targeted download script to recover historical newsletters from a public Google Drive.
- **Physical Organization**: Organized into a clean `data/masters/[YEAR]/newsletters` hierarchy.
- **Assets Recovered**: **28 full-issue PDFs** spanning 1974 to 1979 (Vol 1-3, plus early Missouri Valley articles).

### Phase 11: OlyStats Historical Asset Recovery

[COMPLETED] Performed wide CDX API discovery on `olystats.com` to recover lost historical databases and pages.
- **Exhaustive Discovery**: Scanned over 10,290 Wayback Machine snapshots.
- **Deduplication**: Filtered down to **565 unique physical files** (HTML pages, PDFs, Docs) representing the most complete historical surface area.
- **Integration**: Fully cataloged under a new `olystats` era in the unified inventory.

### Phase 12: USAW.org Early-Web "Hole Filling"

[COMPLETED] Analyzed and recovered the separate `usaw.org` domain mirroring early web presence.
- **Deduplicated Targets**: Condensed 36 distinct snapshots into 7 pure, unique historical result pages (including 1999 Collegiate Nationals and 1999 Junior Nationals).
- **Integration**: Files dynamically injected directly into the core `early-web` era folder structure and inventory map.

### Phase 13: Comprehensive USAW.org Base Recovery

[COMPLETED] Re-visited the `usaw.org` domain to remove strict 'results' keyword matching to ensure maximum historical preservation.
- **Deep Discovery**: Captured 265 pure, unique `.htm` and `.html` files including missing board minutes, coaching education archives, bylaws, club directories, and more long-tail results.
- **Integration**: Segregated and preserved within the `early-web` era taxonomy for offline browsing.

### Phase 14: Mindspring Domain Historical Recovery

[COMPLETED] Executed an unfiltered recovery on the specific user directory `mindspring.com/~us003288/*` to capture deep historical assets from the late 90s/early 2000s.
- **Result**: Successfully acquired **116 distinct physical assets** including HTML results, images, and documents without any keyword bias.
- **Integration**: Bound natively into the `early-web` era timeline in the unified inventory.

## Final Statistics

- **Total Files Recovered**: 8,100+ unique assets
- **History Preserved**: Continuous results archive from 1998 to 2015, expanded historical coverage for AAU (1992+), Ohio LWC, National Masters Weightlifting (1974-1979), OlyStats, USAW.org, and Mindspring directories.

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
