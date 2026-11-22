import { execFileSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

// This build script copies all .template.ts files from the "src" directory to the "dist" directory.
// This is necessary because the .template.ts files are used to generate the actual source files.
const templateFiles = findFilesWithSuffix(path.join(__dirname, 'src'), ['.template.ts', '.template.tsx']);
for (const file of templateFiles) {
    // copy to the equivalent path in the "dist" rather than "src" directory
    const relativePath = path.relative(path.join(__dirname, 'src'), file);
    const distPath = path.join(__dirname, 'dist', relativePath);
    fs.ensureDirSync(path.dirname(distPath));
    fs.copyFileSync(file, distPath);
}

const cliBinPath = path.join(__dirname, 'dist', 'cli.js');
if (fs.existsSync(cliBinPath)) {
    fs.chmodSync(cliBinPath, 0o755); // NOSONAR - workspace bin symlinks must remain executable after local builds.
}

// Writes `dist/vendure-commands.json`, from the commands declared with
// `defineCommand`. The package ships it, and the host builds those commands from it at runtime.
// The compiled modules are ES modules, so a separate Node process loads them.
const writeManifest = `
const { coreCommandDefinitions } = await import('./dist/command-host/core-commands.js');
const { writeCommandManifest } = await import('@vendure/common/lib/command/manifest');
const { name, version } = JSON.parse(await (await import('node:fs/promises')).readFile('./package.json', 'utf-8'));
await writeCommandManifest('./dist', name, version, coreCommandDefinitions);
`;
execFileSync(process.execPath, ['--input-type=module', '--eval', writeManifest], {
    cwd: __dirname,
    stdio: 'inherit',
});

function findFilesWithSuffix(directory: string, suffix: string | string[]): string[] {
    const files: string[] = [];
    const suffixes = Array.isArray(suffix) ? suffix : [suffix];

    function traverseDirectory(dir: string) {
        const dirContents = fs.readdirSync(dir);

        dirContents.forEach(item => {
            const itemPath = path.join(dir, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                traverseDirectory(itemPath);
            } else if (suffixes.some(s => item.endsWith(s))) {
                files.push(itemPath);
            }
        });
    }

    traverseDirectory(directory);

    return files;
}
