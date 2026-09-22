import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { findPackageRoot } from '../vite-plugin-vendure-dashboard.js';

// #4053 — the previous implementation walked up a fixed number of directories
// from the resolved `@vendure/dashboard` entry file, assuming it always sits
// the same number of levels below the package root. That only holds for this
// monorepo's own workspace-linked source; under an NX workspace (or any setup
// where the package resolves to a different entry depth) the fixed walk-up
// landed outside the package entirely.
describe('findPackageRoot', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map(dir => fs.remove(dir)));
    });

    async function createTempDir(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-package-root-'));
        tempDirs.push(dir);
        return dir;
    }

    it('finds the package root when the entry file is 2 levels deep', async () => {
        const root = await createTempDir();
        await fs.outputJson(path.join(root, 'package.json'), { name: '@vendure/dashboard' });
        const entryFile = path.join(root, 'dist', 'index.js');
        await fs.outputFile(entryFile, '');

        expect(findPackageRoot(entryFile, '@vendure/dashboard', 'fallback-should-not-be-used')).toBe(root);
    });

    it('finds the package root when the entry file is 3 levels deep', async () => {
        const root = await createTempDir();
        await fs.outputJson(path.join(root, 'package.json'), { name: '@vendure/dashboard' });
        const entryFile = path.join(root, 'src', 'lib', 'index.ts');
        await fs.outputFile(entryFile, '');

        expect(findPackageRoot(entryFile, '@vendure/dashboard', 'fallback-should-not-be-used')).toBe(root);
    });

    it('does not stop at an unrelated package.json belonging to a different package', async () => {
        const root = await createTempDir();
        const nested = path.join(root, 'node_modules', 'some-other-dep');
        await fs.outputJson(path.join(nested, 'package.json'), { name: 'some-other-dep' });
        await fs.outputJson(path.join(root, 'package.json'), { name: '@vendure/dashboard' });
        const entryFile = path.join(nested, 'dist', 'index.js');
        await fs.outputFile(entryFile, '');

        expect(findPackageRoot(entryFile, '@vendure/dashboard', 'fallback-should-not-be-used')).toBe(root);
    });

    it('falls back when no matching package.json is found', async () => {
        const root = await createTempDir();
        const entryFile = path.join(root, 'dist', 'index.js');
        await fs.outputFile(entryFile, '');

        expect(findPackageRoot(entryFile, '@vendure/dashboard', 'the-fallback-value')).toBe(
            'the-fallback-value',
        );
    });
});
