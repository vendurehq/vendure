import { MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RefusedManifest } from '../manifest.js';

import { ListedCommands, ProjectCommandWatcher } from './project-commands.js';

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
function touch(file: string, content: string) {
    fs.writeFileSync(file, content);
    const later = new Date(Date.now() + 5_000);
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
