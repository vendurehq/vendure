import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createProjectTree as makeTree, removeProjectTrees } from './__tests__/project-tree.js';
import { requireFromProject, requireFromProjectCore, withCoreRunningInCli } from './project-core.js';

describe('requireFromProjectCore()', () => {
    afterEach(() => {
        removeProjectTrees();
    });

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
            `Could not load "typeorm" from ${root}`,
        );
    });

    it('names @vendure/core when it is not installed', () => {
        const root = makeTree({ 'package.json': project });

        expect(() => requireFromProjectCore('typeorm', root)).toThrow(
            `Could not load "@vendure/core" from ${root}`,
        );
    });
});

describe('withCoreRunningInCli()', () => {
    afterEach(() => {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    });

    it('sets the variable while the function runs, and removes it afterwards', async () => {
        const seen = await withCoreRunningInCli(() => Promise.resolve(process.env.VENDURE_RUNNING_IN_CLI));

        expect(seen).toBe('true');
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('restores the value a caller set before', async () => {
        process.env.VENDURE_RUNNING_IN_CLI = 'outer';

        await withCoreRunningInCli(() => Promise.resolve());

        expect(process.env.VENDURE_RUNNING_IN_CLI).toBe('outer');
    });

    // The first call to end must not turn core's logging back on for one still running.
    it('keeps the variable set until the last of overlapping calls ends', async () => {
        let finishFirst = () => undefined as void;
        const first = withCoreRunningInCli(() => new Promise<void>(resolve => (finishFirst = resolve)));
        let seenBySecond: string | undefined;
        const second = withCoreRunningInCli(async () => {
            finishFirst();
            await first;
            seenBySecond = process.env.VENDURE_RUNNING_IN_CLI;
        });

        await second;

        expect(seenBySecond).toBe('true');
        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });

    it('restores the variable when the function throws', async () => {
        await expect(withCoreRunningInCli(() => Promise.reject(new Error('failed')))).rejects.toThrow(
            'failed',
        );

        expect(process.env.VENDURE_RUNNING_IN_CLI).toBeUndefined();
    });
});
