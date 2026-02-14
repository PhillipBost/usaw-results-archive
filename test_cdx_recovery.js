const axios = require('axios');

async function getWaybackSnapshot(originalUrl, timestamp) {
    // CDX API to find closest snapshot
    // reference: http://web.archive.org/cdx/search/cdx?url={url}&output=json&limit=1&closest={timestamp}
    const cdxUrl = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(originalUrl)}&output=json&limit=1&closest=${timestamp}`;

    console.log(`Querying CDX: ${cdxUrl}`);

    try {
        const response = await axios.get(cdxUrl, { timeout: 10000 });
        const data = response.data;

        if (data && data.length > 1) {
            // data[0] is header, data[1] is result
            // Fields: usually urlkey, timestamp, original, mimetype, statuscode, digest, length
            // But standard output is: urlkey, timestamp, original, mimetype, statuscode, digest, length
            // Let's print header to be sure or just assume position 1 is timestamp based on standard
            console.log('CDX Response:', data);

            const row = data[1];
            const ts = row[1]; // Timestamp is usually 2nd column (index 1)

            // Construct direct wayback URL
            // pattern: http://web.archive.org/web/{timestamp}id_/{originalUrl}
            const manualUrl = `http://web.archive.org/web/${ts}id_/${originalUrl}`;
            return manualUrl;
        }
    } catch (error) {
        console.error('CDX Error:', error.message);
    }
    return null;
}

async function test() {
    // The problematic CSS file
    // Based on HTML: <link ... href="../../assets/a090..." ...>
    // Original relative path in HTML: "networks/USAVision/menu/menu.css"
    // Page URL: http://www.msbn.tv/usavision/eventDetails.aspx
    // Resolved Original URL: http://www.msbn.tv/usavision/networks/USAVision/menu/menu.css

    const originalUrl = 'http://www.msbn.tv/usavision/networks/USAVision/menu/menu.css';
    const targetTimestamp = '20060504'; // Approximate timestamp from the era

    console.log(`Testing recovery for: ${originalUrl}`);

    const waybackUrl = await getWaybackSnapshot(originalUrl, targetTimestamp);

    if (waybackUrl) {
        console.log(`\nConstructed URL: ${waybackUrl}`);
        console.log('Attempting download...');

        try {
            const res = await axios.get(waybackUrl, {
                responseType: 'arraybuffer',
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 30000
            });

            console.log(`\nStatus: ${res.status}`);
            console.log(`Content-Length: ${res.data.length} bytes`);
            if (res.data.length > 0) {
                console.log('SUCCESS! Got non-empty content using CDX method.');
            } else {
                console.log('FAILED: Content is still empty.');
            }
        } catch (e) {
            console.error('Download error:', e.message);
        }
    } else {
        console.log('Failed to find snapshot in CDX.');
    }
}

test();
