import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { requireFromProject, requireFromProjectCore } from './project-core';

describe('requireFromProjectCore()', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    function makeTree(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-project-core-'));
        tempDirs.push(root);
        for (const [relativePath, contents] of Object.entries(files)) {
            const fullPath = path.join(root, relativePath);
            fs.ensureDirSync(path.dirname(fullPath));
            fs.writeFileSync(fullPath, contents, 'utf8');
        }
        return root;
    }

    const project = JSON.stringify({ dependencies: { '@vendure/core': '3.8.1' } });
    const corePackage = JSON.stringify({ name: '@vendure/core', version: '3.8.1', main: 'index.js' });
    const typeormPackage = JSON.stringify({ name: 'typeorm', version: '0.3.21', main: 'index.js' });
    const marker = (label: string) => `module.exports = { label: '${label}' };`;

    it('loads a package nested under the project @vendure/core', () => {
        const root = makeTree({
            'package.json': project,
            'node_modules/@vendure/core/package.json': corePackage,
            'node_modules/@vendure/core/index.js': marker('core'),
            'node_modules/@vendure/core/node_modules/typeorm/package.json': typeormPackage,
            'node_modules/@vendure/core/node_modules/typeorm/index.js': marker('nested'),
        });

        expect(requireFromProjectCore<{ label: string }>('typeorm', root).label).toBe('nested');
    });

    it('prefers the copy @vendure/core resolves over the one at the project root', () => {
        const root = makeTree({
            'package.json': project,
            'node_modules/typeorm/package.json': typeormPackage,
            'node_modules/typeorm/index.js': marker('root'),
            'node_modules/@vendure/core/package.json': corePackage,
            'node_modules/@vendure/core/index.js': marker('core'),
            'node_modules/@vendure/core/node_modules/typeorm/package.json': typeormPackage,
            'node_modules/@vendure/core/node_modules/typeorm/index.js': marker('nested'),
        });

        expect(requireFromProjectCore<{ label: string }>('typeorm', root).label).toBe('nested');
        expect(requireFromProject<{ label: string }>('typeorm', root).label).toBe('root');
    });

    it('loads a hoisted package when @vendure/core has no copy of its own', () => {
        const root = makeTree({
            'package.json': project,
            'node_modules/typeorm/package.json': typeormPackage,
            'node_modules/typeorm/index.js': marker('root'),
            'node_modules/@vendure/core/package.json': corePackage,
            'node_modules/@vendure/core/index.js': marker('core'),
        });

        expect(requireFromProjectCore<{ label: string }>('typeorm', root).label).toBe('root');
    });

    it('follows the symlink of a linked @vendure/core to find its sibling packages', () => {
        const root = makeTree({
            'package.json': project,
            'node_modules/.store/@vendure+core/node_modules/@vendure/core/package.json': corePackage,
            'node_modules/.store/@vendure+core/node_modules/@vendure/core/index.js': marker('core'),
            'node_modules/.store/@vendure+core/node_modules/typeorm/package.json': typeormPackage,
            'node_modules/.store/@vendure+core/node_modules/typeorm/index.js': marker('sibling'),
        });
        fs.ensureDirSync(path.join(root, 'node_modules/@vendure'));
        fs.symlinkSync(
            path.join(root, 'node_modules/.store/@vendure+core/node_modules/@vendure/core'),
            path.join(root, 'node_modules/@vendure/core'),
            'junction',
        );

        expect(requireFromProjectCore<{ label: string }>('typeorm', root).label).toBe('sibling');
        expect(() => requireFromProject('typeorm', root)).toThrow('Could not load "typeorm"');
    });

    it('names the package and the project when the package cannot be found', () => {
        const root = makeTree({
            'package.json': project,
            'node_modules/@vendure/core/package.json': corePackage,
            'node_modules/@vendure/core/index.js': marker('core'),
        });

        expect(() => requireFromProjectCore('typeorm', root)).toThrow(
            new RegExp(`Could not load "typeorm" from ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        );
    });

    it('names the package and the project when @vendure/core is not installed', () => {
        const root = makeTree({ 'package.json': project });

        expect(() => requireFromProjectCore('typeorm', root)).toThrow('Could not load "typeorm"');
    });
});
