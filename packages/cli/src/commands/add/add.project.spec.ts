import { isErrorResult } from '@vendure/common/lib/command';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import { VendurePluginRef } from '../../shared/vendure-plugin-ref.js';

import { findPlugin } from './add.project.js';

function project(files: Record<string, string>): Project {
    const p = new Project({ useInMemoryFileSystem: true });
    for (const [path, text] of Object.entries(files)) {
        p.createSourceFile(path, text);
    }
    return p;
}

const plugin = (name: string) => `@VendurePlugin({}) export class ${name} {}`;

describe('findPlugin()', () => {
    it('finds the plugin class with the name', () => {
        const found = findPlugin(project({ '/a.ts': plugin('ReviewsPlugin') }), 'ReviewsPlugin');

        expect(found).toBeInstanceOf(VendurePluginRef);
    });

    it('lists the plugins there are when the name is not found', () => {
        const found = findPlugin(project({ '/a.ts': plugin('ReviewsPlugin') }), 'Missing');

        expect(isErrorResult(found) && found).toMatchObject({
            code: 'add.plugin-not-found',
            details: { plugin: 'Missing', available: ['ReviewsPlugin'] },
        });
    });

    // Two plugin classes can share a name in different directories.
    it('refuses a name that more than one plugin class has, and lists their files', () => {
        const found = findPlugin(
            project({ '/one/a.ts': plugin('ReviewsPlugin'), '/two/a.ts': plugin('ReviewsPlugin') }),
            'ReviewsPlugin',
        );

        expect(isErrorResult(found) && found).toMatchObject({
            code: 'add.plugin-ambiguous',
            details: { files: ['/one/a.ts', '/two/a.ts'] },
        });
    });
});
