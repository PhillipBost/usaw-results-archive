const axios = require('axios');

async function check(url) {
    try {
        console.log(`Checking ${url}...`);
        const res = await axios.get(url);
        console.log(`Status: ${res.status}`);
        console.log(`Length: ${res.data.length}`);
    } catch (e) {
        console.log(`Failed: ${e.message}`);
        if (e.response) console.log(`Response Status: ${e.response.status}`);
    }
}

const timestamp = '20050215201529';
const base = `http://web.archive.org/web/${timestamp}id_`;
const css1 = 'http://www.msbn.tv/usavision/networks/USAVision/css/siteStyle.css';
const css2 = 'http://www.msbn.tv/usavision/networks/USAVision/menu/menu.css'; // resolved from relative

(async () => {
    await check(`${base}/${css1}`);
    await check(`${base}/${css2}`);
})();
