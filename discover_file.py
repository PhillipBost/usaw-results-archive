
import argparse
import hashlib
import json
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# --- CONFIGURATION ---
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x44) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
DELAY = 1.5  # Increased slightly for stability
MAX_RETRIES = 3

# Domains known to host USAW/Weightlifting results or archive metadata.
# In --global mode, we automatically discover MORE domains, but this is our baseline.
KNOWN_DOMAINS = [
    "lifttilyadie.com", "msbn.tv", "usaw.org", "iwf.net", "iwf.sport",
    "usaweightlifting.org", "weightlifting.org", "sportsetc.net",
    "utrockets.com", "toledogas.com", "hellotoledo.com", "ohioweightlifting.org",
    "floridaweightlifting.com", "californiaweightlifting.org", "texasweightlifting.org",
    "pennsylvaniaweightlifting.org", "newyorkweightlifting.org", "georgiaweightlifting.com",
    "midwestweightlifting.org", "pacificweightlifting.org", "mountainweightlifting.com",
    "atlanticweightlifting.org", "centralweightlifting.org", "southernweightlifting.com",
    "westernweightlifting.org", "easternweightlifting.org", "northernweightlifting.com",
    "americanweightlifting.org", "nationalweightlifting.org", "worldweightlifting.org",
    "universityweightlifting.edu", "collegeweightlifting.edu", "schoolsweightlifting.edu",
    "sportsarchive.org", "resultsarchive.com", "meetresults.net", "competitionresults.org",
    "eventresults.com", "sanctionresults.net", "liftresults.org", "weightresults.com",
    "powerresults.net", "strengthresults.org", "athleticresults.com", "sportresults.net"
]

# File types to include in the domain-wide CDX scan.
MIMETYPES = [
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "text/html"
]

def cdx_query(params: list, label: str = "CDX") -> list:
    """Execute a CDX query with retries and exponential backoff."""
    api = "https://web.archive.org/cdx/search/cdx"
    encoded_params = urllib.parse.urlencode(params)
    url = f"{api}?{encoded_params}"
    
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
                if not data or len(data) < 2:
                    return []
                return data[1:] # Skip header
        except (urllib.error.URLError, ConnectionResetError, TimeoutError) as e:
            wait = (attempt + 1) * 2
            if attempt < MAX_RETRIES - 1:
                print(f"  [RETRY] {label} failed ({e}). Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [ERROR] {label} failed after {MAX_RETRIES} attempts: {e}")
        except Exception as e:
            print(f"  [WARN] {label} unexpected error: {e}")
            break
    return []

def fetch_hosts_for_keyword(keyword: str) -> list[str]:
    """Find domains associated with a keyword via the internal Wayback host-discovery API."""
    api = "https://web.archive.org/__wb/search/host"
    params = urllib.parse.urlencode({"q": keyword, "limit": "50"})
    url = f"{api}?{params}"
    try:
        # This API requires a Referer to work programmatically
        req = urllib.request.Request(url, headers={
            "User-Agent": USER_AGENT,
            "Referer": "https://web.archive.org/"
        })
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
            # Important: The API uses 'display_name'
            hosts = [item["display_name"] for item in data.get("hosts", [])]
            return hosts
    except Exception as e:
        print(f"  [WARN] Host discovery failed: {e}")
        return []

def fetch_all_files_for_domain(domain: str, mimetypes: list, name_filter: str = None) -> list[dict]:
    """Fetch all files of specific types from a domain via CDX index."""
    all_rows = []
    print(f"  [CDX] Scanning {domain}...")
    
    # We batch by mimetype to keep responses manageable
    for mime in mimetypes:
        params = [
            ("url", domain if domain.startswith("*") else f"{domain}/*"),
            ("matchType", "prefix"),
            ("output", "json"),
            ("filter", f"mimetype:{mime}"),
            ("collapse", "digest")
        ]
        if name_filter:
            # Case-insensitive substring match on 'original' URL
            params.append(("filter", f"original:(?i).*{name_filter}.*"))
        
        rows = cdx_query(params, label=f"{domain} [{mime}]")
        for row in rows:
            all_rows.append({
                "urlkey": row[0], "timestamp": row[1], "original": row[2],
                "mimetype": row[3], "statuscode": row[4], "digest": row[5],
                "length": row[6], "domain": domain
            })
        time.sleep(DELAY + random.random())
    return all_rows

def fetch_archived_html_pages(domain: str, path_pattern: str = "*") -> list[dict]:
    """Return CDX rows for archived HTML pages on a domain."""
    results = cdx_query(
        [
            ("url", f"{domain}/{path_pattern}"),
            ("matchType", "prefix"),
            ("output", "json"),
            ("filter", "mimetype:text/html"),
            ("filter", "statuscode:200"),
            ("collapse", "urlkey")
        ],
        label=f"HTML scan: {domain}"
    )
    pages = []
    for r in results:
        pages.append({"original": r[2], "timestamp": r[1]})
    return pages

def extract_links_from_page(url: str, timestamp: str) -> list[str]:
    """Download an archived HTML page and extract all unique absolute links."""
    wayback_url = f"https://web.archive.org/web/{timestamp}/{url}"
    try:
        req = urllib.request.Request(wayback_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req) as r:
            html = r.read().decode('utf-8', errors='ignore')
            # Extract standard links (absolute only to avoid resolving relative madness)
            links = re.findall(r'href=[\"\'](https?://[^\s\"\'<>]+)[\"\']', html)
            return list(set(links))
    except Exception as e:
        print(f"    [WARN] Failed to scrape {wayback_url}: {e}")
        return []

def main():
    parser = argparse.ArgumentParser(description="Multi-vector File Discovery System for the Internet Archive.")
    parser.add_argument("name", nargs="?", help="Keyword or filename fragment to search (e.g. '09DaritoisMemorial')")
    parser.add_argument("--name", dest="name_flag", help="Alias for the search name")
    parser.add_argument("--global", dest="is_global", action="store_true", help="Perform internet-wide discovery (Host + Metadata)")
    parser.add_argument("--domains", nargs="+", default=KNOWN_DOMAINS, help="Domains to scan (default: known list)")
    parser.add_argument("--mime", nargs="+", default=MIMETYPES, help="Mimetypes to include")
    parser.add_argument("--link-scan", action="store_true", help="Scrape archived HTML pages for deep-linked results")
    parser.add_argument("--output", help="Save results to JSON file")
    parser.add_argument("--trace", action="store_true", help="Show more detailed discovery logs")
    
    args = parser.parse_args()
    raw_name = args.name or args.name_flag
    if not raw_name:
        parser.error("A search name is required (either as a positional argument or via --name)")
    search_name = raw_name.strip()
    mimetypes = args.mime
    
    print(f"\n[1] SEARCHING FOR: '{search_name}'")

    results = {
        "inputs": {"name": search_name, "file": None, "digest": None},
        "digest_matches": [],
        "filename_matches": [],
        "link_scan_matches": [],
        "search_urls": {
            "Google (exact name)": f"https://www.google.com/search?q=%22{urllib.parse.quote(search_name)}%22",
            "Google (filetype)": f"https://www.google.com/search?q=%22{urllib.parse.quote(search_name)}%22+filetype%3Axls+OR+filetype%3Axlsx",
            "Bing (exact name)": f"https://www.bing.com/search?q=%22{urllib.parse.quote(search_name)}%22",
            "archive.org text search": f"https://archive.org/search?query={urllib.parse.quote(search_name)}",
            "Wayback CDX (URL contains name)": f"https://web.archive.org/cdx/search/cdx?url=*&matchType=prefix&output=json&filter=original:.*{urllib.parse.quote(search_name)}.*&limit=20"
        }
    }

    # --- GLOBAL DISCOVERY ENGINE ---
    # In --global mode, we perform an internet-wide discovery across the entire Archive.
    # We use a multi-pronged approach that mimics the Wayback Machine's broad hunt.
    
    if args.is_global and search_name:
        print(f"\n[2] PERFORMING UNCONDITIONALLY GLOBAL HUNT for '{search_name}'...")
        print("    (Searching host indexes and metadata across the entire archive)")
        
        # VECTOR A: Internet Archive Metadata (Items and Collections)
        print("  [IA] Searching item metadata and collections...")
        ia_api = "https://archive.org/advancedsearch.php"
        ia_queries = [
            f"(title:{search_name})", 
            f"(description:{search_name})",
            f"({search_name}) AND (mediatype:data OR mediatype:texts)"
        ]
        for q in ia_queries:
            ia_params = urllib.parse.urlencode({
                "q": q,
                "fl[]": ["identifier", "title", "originalurl", "url"],
                "output": "json",
                "rows": "100"
            })
            try:
                # Official IA API search - finds uploaded items and data collections
                req = urllib.request.Request(f"{ia_api}?{ia_params}", headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req) as r:
                    data = json.loads(r.read().decode())
                    docs = data.get("response", {}).get("docs", [])
                    for doc in docs:
                        res_url = doc.get("originalurl") or doc.get("url")
                        if res_url:
                            if res_url not in [m['original'] for m in results["filename_matches"]]:
                                print(f"    FOUND IN IA METADATA: {res_url}")
                                results["filename_matches"].append({
                                    "original": res_url, "domain": "IA_METADATA", "type": "trace"
                                })
                        else:
                            details_url = f"https://archive.org/details/{doc['identifier']}"
                            print(f"    FOUND IA ITEM: {details_url}")
            except Exception: pass

        # VECTOR B: Wayback Machine Host Index (Mirror Discovery)
        # We find domains associated with the keyword globally and then scan them.
        print("  [WBM] Discovering mirror domains via global index...")
        hosts = fetch_hosts_for_keyword(search_name)
        if hosts:
             print(f"    Identified {len(hosts)} potential domains. Performing broad-range scans...")
             for host in hosts[:100]:
                 # (If user didn't specify domains and we are in global mode, we probe these discovered ones)
                 rows = fetch_all_files_for_domain(host, mimetypes, name_filter=search_name)
                 for row in rows:
                     if row['original'] not in [m['original'] for m in results["filename_matches"]]:
                         print(f"    GLOBAL MATCH (on {host}): {row['original']}")
                         results["filename_matches"].append(row)

        # VECTOR C: CDX "Identity Shotgun"
        # Since CDX cannot search substrings globally (url=* is too large),
        # we probe both global paths AND high-probability TLD segments.
        print("  [CDX] Shotgunning common result paths and TLD segments...")
        fragments = [
            "results", "uploadedFiles", "sanction", "upload", "download", 
            "meet", "event", "competition", "PDF", "XLS"
        ]
        
        # We try TLD prefix searches which are more reliable than url=*
        tlds = ["com", "org", "net", "edu", "gov"]
        for tld in tlds:
            params = [
                ("url", f"{tld})*"), 
                ("matchType", "prefix"),
                ("output", "json"),
                ("filter", f"original:(?i).*{search_name}.*"),
                ("limit", "150"),
            ]
            rows = cdx_query(params, label=f"Global TLD: {tld})*")
            for r in rows:
                entry = {
                    "original": r[2], "mimetype": r[3], "statuscode": r[4], "domain": f"GLOBAL_{tld.upper()}"
                }
                if entry['original'] not in [m['original'] for m in results["filename_matches"]]:
                    print(f"    GLOBAL MATCH ({tld.upper()}): {entry['original']}")
                    results["filename_matches"].append(entry)
            time.sleep(DELAY + (random.random() * 2))

        # Vector C.2: Folder Shotgun for deep discovery
        extended_fragments = fragments + [f.capitalize() for f in fragments]
        for frag in list(set(extended_fragments)):
            params = [
                ("url", f"*/{frag}/*"),
                ("matchType", "prefix"),
                ("output", "json"),
                ("filter", f"original:(?i).*{search_name}.*"),
                ("limit", "150"),
            ]
            rows = cdx_query(params, label=f"Global path: */{frag}/*")
            for r in rows:
                entry = {
                    "original": r[2], "mimetype": r[3], "statuscode": r[4], "domain": "GLOBAL_SHOTGUN"
                }
                if entry['original'] not in [m['original'] for m in results["filename_matches"]]:
                    print(f"    GLOBAL MATCH (Shotgun): {entry['original']}")
                    results["filename_matches"].append(entry)
            time.sleep(DELAY + (random.random() * 2))

        # VECTOR D: Community Discovery (High-Probability Seeds)
        # We also check the top known domains as part of the global hunt.
        print("  [COMMUNITY] Probing high-probability weightlifting archives...")
        for domain in KNOWN_DOMAINS:
            rows = fetch_all_files_for_domain(domain, mimetypes, name_filter=search_name)
            for row in rows:
                if row['original'] not in [m['original'] for m in results["filename_matches"]]:
                    print(f"    DISCOVERED ON {domain}: {row['original']}")
                    results["filename_matches"].append(row)

    # --- Search vector 3: Targeted scan of specified domains ---
    # This only runs if --global is NOT set, or to scan the domains the user explicitly gave.
    # If the user is running global search, we DON'T prioritize known domains unless matched by discovery.
    if not args.is_global and search_name:
        print(f"\n[2] Scanning for '{search_name}' across {len(args.domains)} domains...")
        for domain in args.domains:
            rows = fetch_all_files_for_domain(domain, mimetypes, name_filter=search_name)
            for row in rows:
                if row['original'] not in [m['original'] for m in results["filename_matches"]]:
                    print(f"    MATCH: {row['original']}")
                    results["filename_matches"].append(row)

    # --- Search vector 3: Link scan of archived HTML pages ---
    if args.link_scan and search_name:
        print(f"\n[3] Link-scanning archived HTML pages for '{search_name}'...")
        # (Link scan logic...)
        for domain in args.domains:
            pages = fetch_archived_html_pages(domain)
            for page in pages:
                links = extract_links_from_page(page['original'], page['timestamp'])
                for link in links:
                    if search_name.lower() in link.lower():
                        if link not in [m['original'] for m in results["link_scan_matches"]]:
                            print(f"    FOUND IN LINKS (on {domain}): {link}")
                            results["link_scan_matches"].append({"original": link, "source": page['original']})

    print(f"\n[✓] Results written to: {args.output if args.output else 'stdout'}")
    print(f"[✓] Total matches found: {len(results['filename_matches']) + len(results['link_scan_matches'])}")
    if len(results['filename_matches']) == 0 and len(results['link_scan_matches']) == 0:
        print("    No archived copies found across known domains.")
        print("    → Try the search URLs above for open-web discovery.")
        print("    → Add more domains with --domains and re-run.")
        print("    → Try --link-scan to check archived HTML pages for links.")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)

if __name__ == "__main__":
    main()
