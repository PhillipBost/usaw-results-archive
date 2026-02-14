const fs = require('fs-extra');

async function main() {
    const inventoryPath = 'inventory.json';
    if (!await fs.pathExists(inventoryPath)) {
        console.log('Inventory not found');
        return;
    }

    const inventory = await fs.readJSON(inventoryPath);
    console.log(`Loaded ${inventory.length} items.`);

    // Target filename logic: "eventDetails-7IKMLLYP.html" or similar
    // User active document: ".../eventDetails-7IKMLLYP.html"
    const targetFilename = 'eventDetails-7IKMLLYP.html';

    // Find index
    const index = inventory.findIndex(i => i.filename && i.filename.includes('7IKMLLYP'));

    if (index === -1) {
        console.log(`Target ${targetFilename} NOT found in inventory.`);
        // List first 5 filenames to debug
        console.log('Sample filenames:', inventory.slice(0, 5).map(i => i.filename));
    } else {
        const item = inventory[index];
        console.log(`Found target at index ${index}:`, item);

        // Reset status
        item.status = 'discovered';

        // Move to front so --limit 1 picks it up
        inventory.splice(index, 1);
        inventory.unshift(item);

        console.log('Moved target to front and reset status.');
        await fs.writeJSON(inventoryPath, inventory, { spaces: 2 });
    }
}

main().catch(console.error);
