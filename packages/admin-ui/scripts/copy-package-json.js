const path = require('node:path');
const fs = require('node:fs');
// Copies the main package.json file into the lib directory so that
// ng-packagr can use it when generating the library bundle
console.log('Copying main package.json to library...');
const packageJson = require('../package.json');
const { name, version, license, dependencies, repository } = packageJson;
const subset = { name, version, license, dependencies, repository };

fs.writeFileSync(path.join(__dirname, '/../src/lib/package.json'), JSON.stringify(subset, null, 2), 'utf8');
