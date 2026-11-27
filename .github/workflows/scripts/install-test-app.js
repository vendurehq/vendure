const fs = require('fs');
const path = require('path');

/**
 * Copies the self-hosted test app into a directory and pins its Vendure packages to the version
 * published to Verdaccio, as part of the "publish & install" workflow.
 *
 *   node install-test-app.js <repository root> <target directory> <vendure version>
 */
const [repoRoot, target, version] = process.argv.slice(2);
if (!repoRoot || !target || !version) {
    console.error('Usage: node install-test-app.js <repository root> <target directory> <vendure version>');
    process.exit(1);
}

fs.cpSync(path.join(repoRoot, '.github/workflows/fixtures/self-hosted-app'), target, { recursive: true });
const packageJsonPath = path.join(target, 'package.json');
fs.writeFileSync(
    packageJsonPath,
    fs.readFileSync(packageJsonPath, 'utf-8').replace(/__VENDURE_VERSION__/g, version),
);
console.log(`Copied the self-hosted test app to ${path.resolve(target)}, with Vendure ${version}`);
