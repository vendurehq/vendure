const path = require('node:path');

/**
 * @return {string}
 */
function getPackageDir() {
    const packageArg = process.env.PACKAGE || process.argv.find(arg => arg.startsWith('--package='));
    if (!packageArg) {
        console.error('No package specified! Please pass --package=<packageDirName>');
        process.exit(1);
    }
    const packageDirname = packageArg.split('=')[1];
    return path.join(__dirname, '../packages', packageDirname ?? packageArg, 'e2e');
}

module.exports = { getPackageDir };
