# Offline Asset Archiving Plan

## Goal
Make downloaded HTML files fully self-contained by downloading all referenced assets (images, CSS, JS) locally and rewriting links.

## User Constraints
- "single folder" for assets to avoid clutter.
- No reliance on Wayback Machine for viewing (offline first).
- Restore original look (done via original assets).

## Implementation Details

### 1. Asset Directory
- Create `data/{Era}/assets` to store assets specific to that era.
- Use hashed filenames (MD5 of URL) to prevent collisions within the era.

### 2. Processing Logic (in `src/index.ts`)
For each downloaded `.html` file:
1.  Parse HTML.
2.  Identify resource URLs (`src="..."`, `href="..."` for CSS).
3.  For each resource:
    - Resolve to absolute Wayback URL.
    - Generate unique local filename: `data/{Era}/assets/<hash>.<ext>`.
    - Download file if not exists.
    - **Rewrite** the link in HTML to point to `../../assets/<hash>.<ext>`.

### 3. Dependencies
- Use existing `axios` for downloads.
- Use `crypto` (built-in) for hashing.
- Use Regex for parsing (simple and sufficient for `src`/`href`).

## Asset Types to Capture
- Images (`.jpg`, `.gif`, `.png`)
- CSS (`.css`)
- JS (`.js`) - optional, but good for completeness.
