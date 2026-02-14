const fs = require('fs');
const invPath = 'c:/Users/phill/Desktop/Bost Laboratory Services/Weightlifting/USAW Results Archive/inventory.json';
const logPath = 'c:/Users/phill/Desktop/Bost Laboratory Services/Weightlifting/USAW Results Archive/download.log';

console.log('--- Checking Inventory ---');
try {
    const inventory = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    const discovered = inventory.filter(i => i.status === 'discovered');
    console.log(`Total items: ${inventory.length}`);
    console.log(`Discovered items: ${discovered.length}`);
    console.log(`First discovered item status: ${discovered.length > 0 ? discovered[0].status : 'N/A'}`);
} catch (e) {
    console.log(`Error reading inventory: ${e.message}`);
}

console.log('--- Checking Log File Snippets ---');
let content;
try {
    content = fs.readFileSync(logPath);
    if (content[0] === 0xFF && content[1] === 0xFE) {
        content = fs.readFileSync(logPath, 'utf16le');
    } else {
        content = content.toString('utf8');
    }
} catch {
    content = "";
}

const lines = content.split('\n');
console.log(`Log file has ${lines.length} lines.`);

// Filter for download attempts to see original URLs
const interesting = lines.filter(l => l.includes('Attempting download') && (l.includes('.css') || l.includes('CSS')));

if (interesting.length === 0) {
    const msg = 'No WARN messages found.\n';
    console.log(msg);
    fs.writeFileSync('debug_result.txt', msg);
} else {
    const msg = `Found ${interesting.length} WARN messages:\n` + interesting.join('\n');
    console.log(msg);
    fs.writeFileSync('debug_result.txt', msg);
}
