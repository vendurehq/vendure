const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Checks what `@vendure/create --yes --json --no-install` wrote, as part of the "publish & install"
 * workflow.
 *
 *   node check-create-result.js <result.json> <package manager> [storefront]
 *
 * The result file is create's stdout. The project is a Vendure Cloud app, so no self-hosted file
 * may be in it.
 */
const [resultPath, packageManager, storefront = null] = process.argv.slice(2);

function fail(message) {
    console.error(`::error::${message}`);
    process.exit(1);
}

function assert(condition, message) {
    if (!condition) {
        fail(message);
    }
}

// A package manager's dlx can print its own progress on stdout before create runs, so the result
// is the last JSON document in the file, which create prints with a `{` at the start of a line.
const output = fs.readFileSync(resultPath, 'utf-8');
const start = output.lastIndexOf('\n{') + 1;
const result = JSON.parse(output.slice(start));
console.log(JSON.stringify(result, null, 2));
assert(!result.error, `create failed: ${JSON.stringify(result.error)}`);
assert(result.packageManager === packageManager, `Expected ${packageManager}, got ${result.packageManager}`);
assert(
    result.git && result.git.status === 'committed',
    `Expected a git commit, got ${JSON.stringify(result.git)}`,
);
assert(
    Array.isArray(result.next) && result.next.includes(`${packageManager} run dev`),
    `Expected "${packageManager} run dev" in next: ${JSON.stringify(result.next)}`,
);

const root = result.projectDir;
const serverDir = storefront ? path.join(root, 'apps/server') : root;
for (const file of [
    'package.json',
    'tsconfig.json',
    '.gitignore',
    'src/vendure-config.ts',
    'src/migrations/.gitkeep',
    '.vendure/create.json',
]) {
    assert(fs.existsSync(path.join(serverDir, file)), `Expected ${file} in ${serverDir}`);
}
for (const file of [
    'src/index.ts',
    'src/index-worker.ts',
    'Dockerfile',
    'docker-compose.yml',
    '.env',
    'vite.config.mts',
]) {
    assert(!fs.existsSync(path.join(serverDir, file)), `Expected no ${file} in ${serverDir}`);
}
if (storefront) {
    assert(fs.existsSync(path.join(root, 'apps/storefront/package.json')), 'Expected the storefront');
}

const config = fs.readFileSync(path.join(serverDir, 'src/vendure-config.ts'), 'utf-8');
assert(config.includes('defineCloudConfig('), 'Expected a Cloud Config');
assert(config.includes('McpPlugin.init('), 'Expected the MCP plugin');

const pkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf-8'));
assert(pkg.scripts.dev === 'vendure dev', `Unexpected dev script: ${pkg.scripts.dev}`);
assert(pkg.vendure.cli.plugins.includes('@vendure/cloud'), 'Expected @vendure/cloud as a CLI plugin');

const record = JSON.parse(fs.readFileSync(path.join(serverDir, '.vendure/create.json'), 'utf-8'));
assert(record.version === 1, `Unexpected record version ${record.version}`);
assert(record.packageManager === packageManager, `Unexpected record packageManager ${record.packageManager}`);
assert(record.storefront === storefront, `Unexpected record storefront ${record.storefront}`);

const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf-8');
assert(agents.includes(`\`${packageManager} run dev\``), `Expected AGENTS.md to use ${packageManager}`);
for (const file of [
    'CLAUDE.md',
    '.claude/settings.json',
    '.mcp.json',
    '.cursor/mcp.json',
    '.agents/skills/vendure-cli/SKILL.md',
]) {
    assert(fs.existsSync(path.join(root, file)), `Expected the agent file ${file}`);
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();
assert(git('rev-list', '--count', 'HEAD') === '1', 'Expected exactly one commit');
assert(git('status', '--porcelain') === '', 'Expected a clean working tree after the initial commit');
assert(
    git('ls-files')
        .split('\n')
        .includes(
            path.relative(root, path.join(serverDir, '.vendure/create.json')).split(path.sep).join('/'),
        ),
    'Expected .vendure/create.json to be committed',
);

console.log('The created project is a committed Vendure Cloud app ✓');
