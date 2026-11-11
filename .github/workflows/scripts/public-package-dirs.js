// Prints the directory of each package in packages/* that is not private, one per line.
// The publish steps loop over this list.
const fs = require('node:fs');
const path = require('node:path');

const packagesDir = path.join(__dirname, '../../../packages');

for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    const manifestPath = path.join(packagesDir, entry.name, 'package.json');
    if (!entry.isDirectory() || !fs.existsSync(manifestPath)) {
        continue;
    }
    if (!JSON.parse(fs.readFileSync(manifestPath, 'utf8')).private) {
        console.log(path.join('packages', entry.name));
    }
}
