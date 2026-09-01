import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { runDependencyCheck } from './dependency-check';

describe('dependency-check', () => {
    let originalCwd: string;
    let tmpDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-dep-'));
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.removeSync(tmpDir);
    });

    it('finds a DB driver hoisted to an ancestor node_modules', async () => {
        // Simulate a monorepo: root/node_modules/pg exists,
        // but root/packages/api/node_modules does NOT.
        const appDir = path.join(tmpDir, 'packages', 'api');
        fs.mkdirpSync(appDir);
        fs.writeJsonSync(path.join(appDir, 'package.json'), {
            name: 'api',
            dependencies: { '@vendure/core': '3.7.2', pg: '8.20.0' },
        });
        // Config file that references postgres
        fs.writeFileSync(
            path.join(appDir, 'vendure-config.ts'),
            'export const config = { dbConnectionOptions: { type: \'postgres\' } };',
        );
        // @vendure/core hoisted to workspace root (needed so the "not installed" early return doesn't fire)
        const corePkgDir = path.join(tmpDir, 'node_modules', '@vendure', 'core');
        fs.mkdirpSync(corePkgDir);
        fs.writeJsonSync(path.join(corePkgDir, 'package.json'), {
            name: '@vendure/core',
            version: '3.7.2',
            main: 'index.js',
        });
        fs.writeFileSync(path.join(corePkgDir, 'index.js'), '');
        // pg hoisted to workspace root
        fs.mkdirpSync(path.join(tmpDir, 'node_modules', 'pg'));
        fs.writeJsonSync(path.join(tmpDir, 'node_modules', 'pg', 'package.json'), {
            name: 'pg',
            version: '8.20.0',
            main: 'index.js',
        });
        fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pg', 'index.js'), '');

        process.chdir(appDir);
        const result = await runDependencyCheck();

        expect(result.details?.some(d => d.includes('DB driver pg') && d.includes('8.20.0'))).toBe(true);
    });

    it('finds @vendure/* packages via require.resolve when hoisted', async () => {
        const appDir = path.join(tmpDir, 'packages', 'api');
        fs.mkdirpSync(appDir);
        fs.writeJsonSync(path.join(appDir, 'package.json'), { name: 'api' });

        // @vendure/core hoisted to root
        const corePkgDir = path.join(tmpDir, 'node_modules', '@vendure', 'core');
        fs.mkdirpSync(corePkgDir);
        fs.writeJsonSync(path.join(corePkgDir, 'package.json'), {
            name: '@vendure/core',
            version: '3.7.2',
            main: 'index.js',
        });
        fs.writeFileSync(path.join(corePkgDir, 'index.js'), '');

        // @vendure/common hoisted to root
        const commonPkgDir = path.join(tmpDir, 'node_modules', '@vendure', 'common');
        fs.mkdirpSync(commonPkgDir);
        fs.writeJsonSync(path.join(commonPkgDir, 'package.json'), {
            name: '@vendure/common',
            version: '3.7.2',
            main: 'index.js',
        });
        fs.writeFileSync(path.join(commonPkgDir, 'index.js'), '');

        process.chdir(appDir);
        const result = await runDependencyCheck();

        expect(result.details?.some(d => d.includes('All @vendure/* packages at 3.7.2'))).toBe(true);
    });

    it('detects mismatched @vendure/* versions via require.resolve', async () => {
        const appDir = path.join(tmpDir, 'packages', 'api');
        fs.mkdirpSync(appDir);
        fs.writeJsonSync(path.join(appDir, 'package.json'), { name: 'api' });

        // @vendure/core at root
        const corePkgDir = path.join(tmpDir, 'node_modules', '@vendure', 'core');
        fs.mkdirpSync(corePkgDir);
        fs.writeJsonSync(path.join(corePkgDir, 'package.json'), {
            name: '@vendure/core',
            version: '3.7.2',
            main: 'index.js',
        });
        fs.writeFileSync(path.join(corePkgDir, 'index.js'), '');

        // @vendure/common at a different version
        const commonPkgDir = path.join(tmpDir, 'node_modules', '@vendure', 'common');
        fs.mkdirpSync(commonPkgDir);
        fs.writeJsonSync(path.join(commonPkgDir, 'package.json'), {
            name: '@vendure/common',
            version: '3.7.1',
            main: 'index.js',
        });
        fs.writeFileSync(path.join(commonPkgDir, 'index.js'), '');

        process.chdir(appDir);
        const result = await runDependencyCheck();

        expect(result.details?.some(d => d.includes('Mismatched') && d.includes('patch'))).toBe(true);
    });

    it('handles exports-map fallback when package.json is not exported', async () => {
        // Simulate a package whose exports map omits ./package.json
        // (like mysql2 3.x). require.resolve('pkg/package.json') will throw
        // ERR_PACKAGE_PATH_NOT_EXPORTED, but require.resolve('pkg') succeeds.
        const appDir = path.join(tmpDir, 'app');
        fs.mkdirpSync(appDir);
        fs.writeJsonSync(path.join(appDir, 'package.json'), { name: 'app' });
        fs.writeFileSync(
            path.join(appDir, 'vendure-config.ts'),
            'export const config = { dbConnectionOptions: { type: \'mysql\' } };',
        );

        // Create mysql2 with an exports map that omits ./package.json
        const mysql2Dir = path.join(appDir, 'node_modules', 'mysql2');
        fs.mkdirpSync(mysql2Dir);
        fs.writeJsonSync(path.join(mysql2Dir, 'package.json'), {
            name: 'mysql2',
            version: '3.5.0',
            main: 'index.js',
            exports: {
                '.': './index.js',
                // Note: no './package.json' entry
            },
        });
        fs.writeFileSync(path.join(mysql2Dir, 'index.js'), '');

        process.chdir(appDir);
        const result = await runDependencyCheck();

        // Should find the driver despite the missing exports entry
        expect(result.details?.some(d => d.includes('DB driver mysql2') && d.includes('installed'))).toBe(true);
    });

    it('reports DB driver as not installed when truly missing', async () => {
        const appDir = path.join(tmpDir, 'app');
        fs.mkdirpSync(appDir);
        fs.mkdirpSync(path.join(appDir, 'node_modules'));
        fs.writeJsonSync(path.join(appDir, 'package.json'), { name: 'app' });
        fs.writeFileSync(
            path.join(appDir, 'vendure-config.ts'),
            'export const config = { dbConnectionOptions: { type: \'postgres\' } };',
        );

        process.chdir(appDir);
        const result = await runDependencyCheck();

        expect(result.details?.some(d => d.includes('not installed'))).toBe(true);
    });

    it('detects duplicate singleton packages in nested node_modules', async () => {
        const appDir = path.join(tmpDir, 'app');
        fs.mkdirpSync(appDir);
        fs.writeJsonSync(path.join(appDir, 'package.json'), { name: 'app' });

        // Root graphql
        const rootGraphql = path.join(appDir, 'node_modules', 'graphql');
        fs.mkdirpSync(rootGraphql);
        fs.writeJsonSync(path.join(rootGraphql, 'package.json'), {
            name: 'graphql',
            version: '16.11.0',
        });

        // Nested duplicate graphql under msw
        const nestedGraphql = path.join(appDir, 'node_modules', 'msw', 'node_modules', 'graphql');
        fs.mkdirpSync(nestedGraphql);
        fs.writeJsonSync(path.join(nestedGraphql, 'package.json'), {
            name: 'graphql',
            version: '16.14.0',
        });

        process.chdir(appDir);
        const result = await runDependencyCheck();

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('Multiple graphql versions'))).toBe(true);
    });
});
