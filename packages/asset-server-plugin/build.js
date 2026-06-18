const fs = require('node:fs');
const path = require('node:path');

fs.copyFileSync(path.join(__dirname, 'src/file-icon.png'), path.join(__dirname, 'lib/src/file-icon.png'));
