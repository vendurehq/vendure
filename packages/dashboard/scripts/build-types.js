#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the type declarations of the `@vendure/dashboard` entry into `dist/types`, so that
 * projects get the types without compiling the dashboard's source, and without mapping the
 * `@/vdb/*` alias in their tsconfig.
 *
 * tsc keeps path aliases in the declarations it emits, so `@/vdb/*` imports are rewritten to
 * relative paths afterwards. Hand-written `.d.ts` files are not emitted by tsc and are copied.
 */

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcLib = path.join(packageRoot, 'src/lib');
const outRoot = path.join(packageRoot, 'dist/types');
const outLib = path.join(outRoot, 'lib');

fs.rmSync(outRoot, { recursive: true, force: true });
execFileSync(
    process.execPath,
    [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.types.json'],
    { cwd: packageRoot, stdio: 'inherit' },
);

// Ambient module declarations for the virtual modules: only the dashboard's own source uses them.
const notCopied = new Set([path.join(srcLib, 'virtual.d.ts')]);
for (const file of walk(srcLib)) {
    if (file.endsWith('.d.ts') && !notCopied.has(file)) {
        const target = path.join(outLib, path.relative(srcLib, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
    }
}

const aliasImport = /(from\s+|import\()(['"])@\/vdb\/([^'"]+)\2/g;
let rewritten = 0;
for (const file of walk(outRoot)) {
    if (!file.endsWith('.d.ts')) {
        continue;
    }
    const content = fs.readFileSync(file, 'utf-8');
    const updated = content.replace(aliasImport, (_match, prefix, quote, target) => {
        let relative = path.relative(path.dirname(file), path.join(outLib, target)).replaceAll('\\', '/');
        if (!relative.startsWith('.')) {
            relative = `./${relative}`;
        }
        return `${prefix}${quote}${relative}${quote}`;
    });
    if (updated !== content) {
        fs.writeFileSync(file, updated);
        rewritten++;
    }
}

const remaining = [...walk(outRoot)].filter(file => /['"]@\/vdb\//.test(fs.readFileSync(file, 'utf-8')));
if (remaining.length) {
    console.error(`@/vdb imports left in ${remaining.length} declaration files, e.g. ${remaining[0]}`);
    process.exit(1);
}
console.log(`Built the type declarations into dist/types (${rewritten} files with rewritten @/vdb imports)`);

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(fullPath);
        } else {
            yield fullPath;
        }
    }
}
