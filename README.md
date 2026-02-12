# USA Weightlifting Results Archive Scraper

A tool to scrape and download historical USA Weightlifting documents (results, minutes, etc.) from the Wayback Machine.

## historical search context

The following domains and timeframes identify where USA Weightlifting content was hosted:

### Era 1: The Early Web (2000 - ~Aug 2004)
- **Primary Domain**: `usaweightlifting.org` (and `www.usaweightlifting.org`)
- **Key Paths**:
  - `/results.html`
  - `/localeventresults.html`
  - `/results/*.htm`
- **Known Examples**:
  - Results Page: [`http://usaweightlifting.org/results.html`](https://web.archive.org/web/20040401210653/http://usaweightlifting.org/results.html)
  - Specific Result: [`http://www.usaweightlifting.org/results/98natjun.htm`](https://web.archive.org/web/20001210005300fw_/http://www.usaweightlifting.org/results/98natjun.htm)
  - Local Results: [`http://usaweightlifting.org/localeventresults.html`](https://web.archive.org/web/20040417121819/http://usaweightlifting.org/localeventresults.html)

### Era 2: MSBN TV (Aug 2004 - ~Jan 2008)
- **Redirect**: `usaweightlifting.org` -> `msbn.tv/usavision/index.aspx`
- **Key Paths**:
  - `http://www.msbn.tv/usavision/*`
  - `http://www.msbn.tv/usavision/uploadedImages/USA_Weightlifting/pdf/*.pdf`
- **Known Examples**:
  - Results Listing: [`http://www.msbn.tv/usavision/displaypage.aspx?id=410`](https://web.archive.org/web/20040925101340/http://www.msbn.tv/usavision/displaypage.aspx?id=410)
  - PDF Document: [`http://www.msbn.tv/usavision/uploadedImages/USA_Weightlifting/pdf/April2004.pdf`](https://web.archive.org/web/20040926082204/http://www.msbn.tv/usavision/uploadedImages/USA_Weightlifting/pdf/April2004.pdf)

### Era 3: Team USA / Hangastar (Jan 2008 - End 2011/2015)
- **Redirect**: `usaweightlifting.org` -> `weightlifting.teamusa.org`
- **System**: Hangastar (used until ~2015).
- **Indexing**: Results were often indexed by **Sanction Number**.
- **Key Resources**:
  - "All Meet Results" pages listed sanction numbers/links:
    - [June 2015 Snapshot](https://web.archive.org/web/20150608012944/http://www.teamusa.org/usa-weightlifting/resources/all-meet-results)
    - [Nov 2015 Snapshot](https://web.archive.org/web/20151112111900/http://www.teamusa.org/usa-weightlifting/resources/all-meet-results)
- **Potential Sources**:
  - `weightlifting.teamusa.org` ([Snapshot](https://web.archive.org/web/20081219012433/http://weightlifting.teamusa.org/))
  - `assets.teamusa.org/assets/documents/` (General Team USA asset server)
- **Note**: A search tool was introduced in 2016 but is likely broken in Wayback Machine. This scraper focuses on the pre-2016 era.

## usage

### installation

```bash
npm install
npm run build
```

### running the scraper

```bash
# General run (all configured domains)
node dist/index.js

# Dry run (see what would be downloaded)
node dist/index.js --dry-run

# Limit files per domain (for testing)
node dist/index.js --limit 5
```

## configuration

Domains and file types are configured in `src/config.ts`.
