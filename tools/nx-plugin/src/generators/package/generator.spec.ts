import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTargets } from '../../create-nodes';
import { readPluginPackage } from '../../package-schema';
import syncTsconfigGenerator from '../sync-tsconfig/generator';

import packageGenerator from './generator';

let tree: Tree;

const reader = () => ({
    exists: (path: string) => tree.exists(path),
    isFile: (path: string) => tree.isFile(path),
    read: (path: string) => tree.read(path, 'utf-8') ?? '',
    children: (path: string) => tree.children(path),
});

beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write('package.json', JSON.stringify({ name: 'workspace', workspaces: ['packages/*'] }));
    tree.write(
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { lib: ['es2019', 'esnext.asynciterable'] } }),
    );
    tree.write('packages/core/package.json', JSON.stringify({ name: '@vendure/core', version: '3.8.1' }));
});

describe('packageGenerator', () => {
    it('creates a package that follows the package schema', async () => {
        await packageGenerator(tree, { name: 'foo-bar-plugin' });

        expect(tree.children('packages/foo-bar-plugin').sort()).toEqual([
            'README.md',
            'e2e',
            'package.json',
            'src',
            'tsconfig.build.json',
            'tsconfig.json',
        ]);
        expect(tree.children('packages/foo-bar-plugin/src').sort()).toEqual([
            'foo-bar.plugin.spec.ts',
            'foo-bar.plugin.ts',
            'index.ts',
        ]);
        expect(tree.read('packages/foo-bar-plugin/src/foo-bar.plugin.ts', 'utf-8')).toContain(
            'export class FooBarPlugin {}',
        );

        const packageJson = JSON.parse(tree.read('packages/foo-bar-plugin/package.json', 'utf-8') ?? '');
        expect(packageJson).toMatchObject({
            name: '@vendure/foo-bar-plugin',
            version: '3.8.1',
            main: 'lib/index.js',
            types: 'lib/index.d.ts',
            nx: { tags: ['scope:plugin'] },
        });
    });

    it('gets every inferred target, and its tsconfig files are in sync', async () => {
        await packageGenerator(tree, { name: 'foo-plugin' });

        const targets = createTargets(readPluginPackage('packages/foo-plugin', reader()));
        expect(Object.keys(targets)).toEqual(['build', 'watch', 'lint', 'test', 'e2e']);
        expect(await syncTsconfigGenerator(tree)).toEqual({});
    });

    it('does not overwrite an existing package', async () => {
        tree.write('packages/foo-plugin/package.json', '{}');

        await expect(packageGenerator(tree, { name: 'foo-plugin' })).rejects.toThrow(
            'packages/foo-plugin already exists',
        );
    });
});
