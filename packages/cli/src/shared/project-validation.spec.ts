import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { findVendureProjectRoot, vendureProjectRequiredMessage } from './project-validation';

describe('findVendureProjectRoot()', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    /**
     * A directory tree under a fresh temp root. `files` maps a relative path to
     * its contents, so a test shows the whole fixture in one place.
     *
     * The root itself holds no package.json, which is what lets a test assert
     * that the walk stops rather than escaping into whatever directory the
     * suite happens to be run from.
     */
    function makeTree(files: Record<string, string>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-project-root-'));
        tempDirs.push(root);
        for (const [relativePath, contents] of Object.entries(files)) {
            const fullPath = path.join(root, relativePath);
            fs.ensureDirSync(path.dirname(fullPath));
            fs.writeFileSync(fullPath, contents, 'utf8');
        }
        return root;
    }

    const withCore = JSON.stringify({ dependencies: { '@vendure/core': '3.7.2' } });

    it('finds a project in the directory it starts from', () => {
        const root = makeTree({ 'shop/package.json': withCore });

        expect(findVendureProjectRoot(path.join(root, 'shop'))).toBe(path.join(root, 'shop'));
    });

    it('finds a project from a subdirectory of it', () => {
        const root = makeTree({
            'shop/package.json': withCore,
            'shop/src/plugins/reviews/.keep': '',
        });

        expect(findVendureProjectRoot(path.join(root, 'shop/src/plugins/reviews'))).toBe(
            path.join(root, 'shop'),
        );
    });

    it('returns the nearest project when several are stacked', () => {
        const root = makeTree({
            'repo/package.json': withCore,
            'repo/packages/server/package.json': withCore,
        });

        expect(findVendureProjectRoot(path.join(root, 'repo/packages/server'))).toBe(
            path.join(root, 'repo/packages/server'),
        );
    });

    it('walks past a package.json that has no Vendure dependency', () => {
        const root = makeTree({
            'repo/package.json': withCore,
            'repo/packages/docs/package.json': JSON.stringify({ dependencies: { typescript: '5.8.2' } }),
        });

        expect(findVendureProjectRoot(path.join(root, 'repo/packages/docs'))).toBe(path.join(root, 'repo'));
    });

    it('accepts any package in the Vendure scope, not one named package', () => {
        const root = makeTree({
            'plugin-repo/package.json': JSON.stringify({
                devDependencies: { '@vendure/cli': '3.7.2' },
            }),
        });

        expect(findVendureProjectRoot(path.join(root, 'plugin-repo'))).toBe(path.join(root, 'plugin-repo'));
    });

    it('returns undefined when no package.json above declares a Vendure dependency', () => {
        const root = makeTree({
            'elsewhere/package.json': JSON.stringify({ dependencies: { express: '4.0.0' } }),
        });

        expect(findVendureProjectRoot(path.join(root, 'elsewhere'))).toBeUndefined();
    });

    it('returns undefined rather than throwing on an unreadable package.json', () => {
        const root = makeTree({ 'broken/package.json': '{ not json' });

        expect(findVendureProjectRoot(path.join(root, 'broken'))).toBeUndefined();
    });
});

describe('vendureProjectRequiredMessage()', () => {
    it('names the whole command path, not just the leaf', () => {
        const message = vendureProjectRequiredMessage(['cloud', 'deploy'], '/home/user');

        expect(message).toContain('vendure cloud deploy must be run from a Vendure project directory.');
        expect(message).toContain('/home/user');
    });
});
