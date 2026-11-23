import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkProjectCli, findMcpProject, resolveCliFrom } from './project.js';

const roots: string[] = [];

/** Writes files under a new temporary directory, and returns its real path. */
function tree(files: Record<string, string>): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-project-')));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    return root;
}

const vendureProject = JSON.stringify({ dependencies: { '@vendure/core': '4.0.0' } });
const cliPackage = (version: string) =>
    JSON.stringify({ name: '@vendure/cli', version, bin: { vendure: 'dist/cli.js' } });

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('findMcpProject()', () => {
    it('finds the project from a subfolder', () => {
        const root = tree({ 'package.json': vendureProject, 'src/plugins/reviews/x.ts': '' });

        expect(findMcpProject(path.join(root, 'src/plugins/reviews'))).toEqual({ kind: 'found', dir: root });
    });

    it('finds the project from a git worktree of it', () => {
        const root = tree({ 'package.json': vendureProject, 'src/x.ts': '' });
        const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
        git('init', '-q');
        git('add', '-A');
        git('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'init');
        const worktree = path.join(root, '..', `${path.basename(root)}-worktree`);
        roots.push(worktree);
        git('worktree', 'add', '-q', worktree);

        expect(findMcpProject(path.join(worktree, 'src'))).toEqual({ kind: 'found', dir: worktree });
    });

    it('finds the one project of a monorepo from its root', () => {
        const root = tree({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'apps/server/package.json': vendureProject,
            'apps/storefront/package.json': JSON.stringify({ dependencies: { next: '15' } }),
        });

        expect(findMcpProject(root)).toEqual({ kind: 'found', dir: path.join(root, 'apps/server') });
        // From another package of the monorepo, it walks up to the root and finds it from there.
        expect(findMcpProject(path.join(root, 'apps/storefront'))).toEqual({
            kind: 'found',
            dir: path.join(root, 'apps/server'),
        });
    });

    it('lists the projects of a monorepo root that holds more than one', () => {
        const root = tree({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'apps/one/package.json': vendureProject,
            'apps/two/package.json': vendureProject,
        });

        expect(findMcpProject(root)).toEqual({
            kind: 'ambiguous',
            root,
            candidates: [path.join(root, 'apps/one'), path.join(root, 'apps/two')],
        });
    });

    // The package-folder search applies only at a git root or a workspace root.
    it('does not take a folder next to an unrelated project for that project', () => {
        const root = tree({
            'apps/shop/package.json': vendureProject,
            'apps/blog/package.json': JSON.stringify({ dependencies: { astro: '5' } }),
        });

        expect(findMcpProject(path.join(root, 'apps/blog'))).toEqual({ kind: 'not-found' });
    });

    it('stops at the git root', () => {
        const outer = tree({ 'package.json': vendureProject, 'inner/package.json': JSON.stringify({}) });
        execFileSync('git', ['init', '-q'], { cwd: path.join(outer, 'inner') });

        expect(findMcpProject(path.join(outer, 'inner'))).toEqual({ kind: 'not-found' });
    });

    it('finds nothing outside a Vendure project', () => {
        const root = tree({ 'package.json': JSON.stringify({ dependencies: { express: '5' } }) });

        expect(findMcpProject(root)).toEqual({ kind: 'not-found' });
    });
});

describe('checkProjectCli()', () => {
    it("accepts the project's own @vendure/cli", () => {
        const root = tree({
            'package.json': vendureProject,
            'node_modules/@vendure/cli/package.json': cliPackage('4.0.0'),
        });

        expect(checkProjectCli(root, path.join(root, 'node_modules/@vendure/cli'), '4.0.0')).toEqual({
            ok: true,
        });
    });

    // npx falls back to a global install when the folder it was started in has none.
    it('refuses another @vendure/cli, and names the version the project installs', () => {
        const root = tree({
            'package.json': vendureProject,
            'node_modules/@vendure/cli/package.json': cliPackage('4.0.0'),
        });
        const global = tree({ 'lib/node_modules/@vendure/cli/package.json': cliPackage('3.8.0') });

        const check = checkProjectCli(root, path.join(global, 'lib/node_modules/@vendure/cli'), '3.8.0');

        expect(check).toMatchObject({
            ok: false,
            reason: 'other-cli',
            runningVersion: '3.8.0',
            local: { version: '4.0.0' },
        });
    });

    it('refuses to serve a project that does not install @vendure/cli', () => {
        const root = tree({ 'package.json': vendureProject });
        const global = tree({ 'lib/node_modules/@vendure/cli/package.json': cliPackage('4.0.0') });

        expect(
            checkProjectCli(root, path.join(global, 'lib/node_modules/@vendure/cli'), '4.0.0'),
        ).toMatchObject({
            ok: false,
            reason: 'not-installed',
        });
    });
});

describe('resolveCliFrom()', () => {
    it('resolves a hoisted install from a monorepo package, with the binary of its package.json', () => {
        const root = tree({
            'node_modules/@vendure/cli/package.json': cliPackage('4.0.0'),
            'apps/server/package.json': vendureProject,
        });

        expect(resolveCliFrom(path.join(root, 'apps/server'))).toEqual({
            dir: path.join(root, 'node_modules/@vendure/cli'),
            version: '4.0.0',
            bin: path.join(root, 'node_modules/@vendure/cli/dist/cli.js'),
        });
    });
});
