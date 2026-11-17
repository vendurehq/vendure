import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProjectTree, removeProjectTrees } from '../../../shared/__tests__/project-tree';

import { runDatabaseCheck } from './database-check';

describe('runDatabaseCheck()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        removeProjectTrees();
    });

    function makeProject(files: Record<string, string>): string {
        const root = createProjectTree({
            'package.json': JSON.stringify({ dependencies: { '@vendure/core': '3.8.1' } }),
            'node_modules/@vendure/core/package.json': JSON.stringify({
                name: '@vendure/core',
                main: 'index.js',
            }),
            'node_modules/@vendure/core/index.js': 'module.exports = {};',
            ...files,
        });
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
        expect(result.details?.join('\n')).toContain('Could not load "typeorm"');
    });
});
