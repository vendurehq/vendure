import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runDatabaseCheck } from './database-check';

describe('runDatabaseCheck()', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    function makeProject(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-database-check-'));
        tempDirs.push(root);
        const base: Record<string, string> = {
            'package.json': JSON.stringify({ dependencies: { '@vendure/core': '3.8.1' } }),
            'node_modules/@vendure/core/package.json': JSON.stringify({
                name: '@vendure/core',
                main: 'index.js',
            }),
            'node_modules/@vendure/core/index.js': 'module.exports = {};',
        };
        for (const [relativePath, contents] of Object.entries({ ...base, ...files })) {
            const fullPath = path.join(root, relativePath);
            fs.ensureDirSync(path.dirname(fullPath));
            fs.writeFileSync(fullPath, contents, 'utf8');
        }
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        return root;
    }

    const fakeTypeorm = `
        exports.DataSource = class DataSource {
            constructor(options) {
                this.options = options;
                this.isInitialized = false;
            }
            async initialize() {
                this.isInitialized = true;
            }
            async destroy() {
                this.isInitialized = false;
            }
        };
    `;

    const config = { dbConnectionOptions: { type: 'postgres', host: 'db', database: 'shop' } } as any;

    it('connects with the typeorm installed under the project @vendure/core', async () => {
        makeProject({
            'node_modules/@vendure/core/node_modules/typeorm/package.json': JSON.stringify({
                name: 'typeorm',
                main: 'index.js',
            }),
            'node_modules/@vendure/core/node_modules/typeorm/index.js': fakeTypeorm,
        });

        const result = await runDatabaseCheck(config);

        expect(result.status).toBe('pass');
        expect(result.message).toBe('Successfully connected to postgres database');
    });

    it('connects with a typeorm hoisted to the project root', async () => {
        makeProject({
            'node_modules/typeorm/package.json': JSON.stringify({ name: 'typeorm', main: 'index.js' }),
            'node_modules/typeorm/index.js': fakeTypeorm,
        });

        const result = await runDatabaseCheck(config);

        expect(result.status).toBe('pass');
    });

    it('warns with the load error when typeorm is not installed at all', async () => {
        makeProject({});

        const result = await runDatabaseCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details.join('\n')).toContain('Could not load "typeorm"');
    });
});
