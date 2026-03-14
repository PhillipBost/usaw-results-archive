# Systematic Discovery and Recovery of Archived Results

When results are missing from the primary mirror and standard scrapers fail, this "Systematic Discovery" approach is used to hunt down files based on their identity rather than known URLs.

## Tools

The primary tool for this process is `discover_file.py`.

### Tool Usage & Help

To see all available options and examples, run:
`python discover_file.py --help`

### Key Command Patterns

* **Targeted Domain Scan (BEST):** `python discover_file.py "Toledo" --domains msbn.tv --trace`
* **Trace Mode (GHOST SEARCH):** `python discover_file.py "18-06-02" --trace` (Finds 301/302 redirects)
* **Global Hunt:** `python discover_file.py "Daritois" --global` (Broad, use for unique terms)
* **Identity Search:** `python discover_file.py --digest "HASH"`

> [!TIP]
> **Discovery Strategy:** Global hunts for common words (like "Toledo") can be slow or hit API limits. **Targeted Domain Scans** are 100x faster and more reliable. Always use `--trace` if the initial scan returns no results.

### Key Discovery Vectors

1. **Global Identity Search (Filename):** Searching the *entire* archive (using `url=*` and filters) for any URL globally that contains the target filename fragment (e.g., `18-06-02`).
2. **Fingerprint Search (Digest):** If a local copy exists, the tool computes its SHA-1 Base32 digest and searches for identical content regardless of domain or filename.
3. **Archival Link Tracing:** Scanning archived HTML source code for links to files that were never formally "crawled" but exist as "ghost" entries.
4. **Open-Web Leads:** Automatically generating targeted search engine queries (Google `filetype:xls`) to find live mirrors or cache versions.

## Discovery Case Study: Toledo Results (18-06-02)

While the tool autonomously found the Daritois results, the Toledo results required a more nuanced approach after they were missing from initial scans.

1. **User Discovery:** The user identified a specific port-variant URL in the archive (`msbn.tv:80`) that was being missed by standard domain-restricted searches.
2. **Software Enhancement:** This led to the implementation of **Global Discovery Mode** (`--global`) and **Wildcard Domain Matching** (`*.domain.com`) in `discover_file.py`.
3. **Verification:** The tool now confirms the capture at: [Wayback Mirror](https://web.archive.org/web/20190829014453/http://www.msbn.tv:80/mmsysFrontEnd/uploadedFiles/Sanction%20number%2018-06-02%20(Toledo,%20OH).xls).
4. **Technical Context:** True global filename searching is challenging because the Wayback Machine indexes by URL, not by filename. The `--global` flag in the tool attempts to bridge this by searching the entire URL index for name fragments.

## Success Metrics

A discovery is considered successful if:

* The file is found and downloaded from a previously unknown URL.
* A content-identical version is found on a different domain.
* The "Ghost URL" is identified for manual deep-web retrieval.
