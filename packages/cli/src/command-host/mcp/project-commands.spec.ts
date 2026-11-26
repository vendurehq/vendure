import { MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandManifest } from '../../shared/__tests__/command-manifest.js';
import { RefusedManifest } from '../manifest.js';

import { ListedCommands, listProjectCommands, ProjectCommandWatcher } from './project-commands.js';

function command(
    commandPath: string[],
    description = `${commandPath.join(' ')} description`,
): MergedManifestCommand {
    return {
        path: commandPath,
        description,
        keywords: [],
        behavior: 'readonly',
        requires: {},
        consents: {},
        input: { type: 'object', properties: {} },
        cli: {},
        errors: [],
        examples: [],
        expose: { mcp: true },
        hasPlan: false,
        source: '@vendure/cli',
    };
}

const dirs: string[] = [];

function tempFile(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-commands-'));
    dirs.push(dir);
    const file = path.join(dir, 'package.json');
    fs.writeFileSync(file, '{}');
    return file;
}

/** Writes the file with new content and a later change time, so the poll sees it. */
let touches = 0;

function touch(file: string, content: string) {
    fs.writeFileSync(file, content);
    const later = new Date(Date.now() + 5_000 * ++touches);
    fs.utimesSync(file, later, later);
}

const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('ProjectCommandWatcher', () => {
    it('polls with a timer that does not keep the process alive, and clears it on close', async () => {
        const unref = vi.fn();
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as any);
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
        try {
            const watcher = new ProjectCommandWatcher({
                cwd: '/project',
                list: async () => ({ commands: [], refused: [], files: [] }),
            });
            await watcher.list();
            watcher.watch();
            expect(unref).toHaveBeenCalledTimes(1);
            watcher.close();
            expect(clearIntervalSpy).toHaveBeenCalledWith(setIntervalSpy.mock.results[0].value);
        } finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });

    it('lists the commands and reports the refused packages', async () => {
        const refused: RefusedManifest[] = [
            { package: 'example', error: { code: 'plugin.unavailable', message: 'gone' } } as RefusedManifest,
        ];
        const onRefused = vi.fn();
        const watcher = new ProjectCommandWatcher({
            cwd: '/project',
            list: async () => ({ commands: [command(['doctor'])], refused, files: [] }),
            onRefused,
        });
        expect((await watcher.list()).map(c => c.path)).toEqual([['doctor']]);
        expect(onRefused).toHaveBeenCalledWith(refused);
    });

    it("offers the CLI's own commands when the listing fails, and says why", async () => {
        const onListingFailed = vi.fn();
        const watcher = new ProjectCommandWatcher({
            cwd: '/project',
            list: async () => {
                throw new Error('broken package.json');
            },
            onListingFailed,
        });
        const commands = await watcher.list();
        expect(commands.some(c => c.path.join(' ') === 'doctor')).toBe(true);
        expect(onListingFailed).toHaveBeenCalledWith('broken package.json');
    });

    it('lists again when a watched file changes, and tells the listeners only when the tools change', async () => {
        const file = tempFile();
        let listed: ListedCommands = { commands: [command(['doctor'])], refused: [], files: [file] };
        const list = vi.fn(async () => listed);
        const watcher = new ProjectCommandWatcher({ cwd: '/project', list, watchIntervalMs: 10 });
        const changes: MergedManifestCommand[][] = [];
        watcher.onChanged(commands => changes.push(commands));
        await watcher.list();
        watcher.watch();
        try {
            // A change to the file that leaves the tools as they were is not reported.
            touch(file, '{ "name": "same" }');
            await until(() => list.mock.calls.length === 2);
            expect(list).toHaveBeenCalledTimes(2);
            expect(changes).toEqual([]);

            listed = { ...listed, commands: [command(['doctor']), command(['example', 'greet'])] };
            touch(file, '{ "name": "enabled" }');
            await until(() => changes.length === 1);
            expect(changes.map(commands => commands.map(c => c.path.join(' ')))).toEqual([
                ['doctor', 'example greet'],
            ]);
        } finally {
            watcher.close();
        }
    });

    it('lists again when a watched file changes while a relisting reads it', async () => {
        const file = tempFile();
        const listed: ListedCommands = { commands: [command(['doctor'])], refused: [], files: [file] };
        let calls = 0;
        const list = vi.fn(async () => {
            calls++;
            if (calls === 2) {
                // Another write lands after this listing read the files, as during an install.
                touch(file, '{ "name": "second write" }');
                return { ...listed, commands: [command(['doctor'])] };
            }
            return calls === 3
                ? { ...listed, commands: [command(['doctor']), command(['example', 'greet'])] }
                : listed;
        });
        const watcher = new ProjectCommandWatcher({ cwd: '/project', list, watchIntervalMs: 10 });
        const changes: MergedManifestCommand[][] = [];
        watcher.onChanged(commands => changes.push(commands));
        await watcher.list();
        watcher.watch();
        try {
            touch(file, '{ "name": "first write" }');
            await until(() => changes.length === 1);
            expect(list).toHaveBeenCalledTimes(3);
            expect(changes[0].map(c => c.path.join(' '))).toEqual(['doctor', 'example greet']);
        } finally {
            watcher.close();
        }
    });

    it('keeps the commands it has when listing again fails', async () => {
        const onListingFailed = vi.fn();
        let fail = false;
        const watcher = new ProjectCommandWatcher({
            cwd: '/project',
            list: async () => {
                if (fail) {
                    throw new Error('half-written package.json');
                }
                return { commands: [command(['doctor'])], refused: [], files: [] };
            },
            onListingFailed,
        });
        const changes: MergedManifestCommand[][] = [];
        watcher.onChanged(commands => changes.push(commands));
        await watcher.list();
        fail = true;
        await watcher.relist();
        expect(onListingFailed).toHaveBeenCalledWith('half-written package.json');
        expect(changes).toEqual([]);
    });
});

describe('ProjectCommandWatcher with the real listing', () => {
    /** A project that enables one package, whose manifest declares `example greet`. */
    function projectWithPlugin() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-listing-'));
        dirs.push(root);
        const packageJson = JSON.stringify({
            name: 'shop',
            dependencies: { '@vendure/core': '*', '@example/tools': '*' },
            vendure: { cli: { plugins: ['@example/tools'] } },
        });
        fs.writeFileSync(path.join(root, 'package.json'), packageJson);
        const plugin = path.join(root, 'node_modules', '@example', 'tools');
        fs.mkdirSync(plugin, { recursive: true });
        fs.writeFileSync(
            path.join(plugin, 'package.json'),
            JSON.stringify({
                name: '@example/tools',
                vendure: { commandManifest: './vendure-commands.json', commandDefinitions: './commands.js' },
            }),
        );
        fs.writeFileSync(
            path.join(plugin, 'vendure-commands.json'),
            JSON.stringify(commandManifest('@example/tools', [['example', 'greet']])),
        );
        fs.writeFileSync(path.join(plugin, 'commands.js'), 'module.exports = { commands: [] };');
        return { root, packageJson };
    }

    const greet = (commands: MergedManifestCommand[]) =>
        commands.filter(c => c.path.join(' ') === 'example greet').length;

    it('watches the package.json of a project that has none yet', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-listing-'));
        dirs.push(root);
        expect((await listProjectCommands(root)).files).toContain(path.join(root, 'package.json'));
    });

    it('keeps the commands while the project package.json is half written, and lists them after', async () => {
        const { root, packageJson } = projectWithPlugin();
        const onListingFailed = vi.fn();
        const watcher = new ProjectCommandWatcher({ cwd: root, onListingFailed, watchIntervalMs: 10 });
        const changes: MergedManifestCommand[][] = [];
        watcher.onChanged(commands => changes.push(commands));
        expect(greet(await watcher.list())).toBe(1);
        watcher.watch();
        try {
            touch(path.join(root, 'package.json'), '{ "name": "shop",');
            await until(() => onListingFailed.mock.calls.length > 0);
            expect(onListingFailed.mock.calls[0][0]).toContain('is not valid JSON');
            expect(changes).toEqual([]);

            // The write finishes, now without the package enabled, and then with it again.
            touch(path.join(root, 'package.json'), packageJson.replace('["@example/tools"]', '[]'));
            await until(() => changes.length === 1);
            expect(greet(changes[0])).toBe(0);
            touch(path.join(root, 'package.json'), packageJson);
            await until(() => changes.length === 2);
            expect(greet(changes[1])).toBe(1);
        } finally {
            watcher.close();
        }
    });
});
