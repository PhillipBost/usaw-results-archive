const fs = require('fs');
const inventoryByPath = 'c:/Users/phill/Desktop/Bost Laboratory Services/Weightlifting/USAW Results Archive/inventory.json';
const inventory = JSON.parse(fs.readFileSync(inventoryByPath, 'utf8'));
inventory.forEach(item => {
    if (item.status === 'downloaded') {
        item.status = 'discovered';
        delete item.localPath; // Clear path to force re-download logic
    }
});
fs.writeFileSync(inventoryByPath, JSON.stringify(inventory, null, 2));
console.log('Reset inventory status to discovered.');
