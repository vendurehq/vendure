import { defineCommand } from '@vendure/common/lib/command';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { jsonRequested, registerManifestCommands } from './commander-adapter.js';
import { buildCommandManifest } from './manifest-build.js';
import { mergeManifests } from './manifest.js';

const demo = defineCommand({
    path: ['add', 'thing'],
    description: 'Adds a thing',
    behavior: 'mutating',
    schemas: async () => ({
        input: z.object({
            name: z.string().describe('The thing name'),
            tags: z.array(z.string()).optional(),
            size: z.number().optional(),
            dryRun: z.boolean().optional(),
            kind: z.enum(['a', 'b']).optional(),
        }),
    }),
    cli: { flags: { name: { short: '-n' } } },
    consents: { overwrite: 'Overwrites it' },
    plan: async () => ({ plan: async () => ({ preview: {}, consents: [] }) }),
    run: async () => ({ run: async () => ({}) }),
});

async function program() {
    const built = await buildCommandManifest('@test/pkg', '1.0.0', [demo]);
    const root = new Command('vendure').exitOverride();
    // A command that already exists, with an action and options of its own, like `vendure add`.
    root.command('add')
        .description('Legacy add')
        .option('--name <name>')
        .action(() => undefined);
    registerManifestCommands(root, mergeManifests([built]), { loadDefinitions: async () => [demo] });
    return root;
}

describe('registerManifestCommands', () => {
    it('adds a command under the group that already exists', async () => {
        const root = await program();
        const add = root.commands.find(c => c.name() === 'add') as Command;
        expect(root.commands.filter(c => c.name() === 'add')).toHaveLength(1);
        expect(add.commands.map(c => c.name())).toEqual(['thing']);
    });

    it('creates a group for a path that has none', async () => {
        const nested = defineCommand({ ...demo, path: ['brand', 'new', 'cmd'] });
        const built = await buildCommandManifest('@test/pkg', '1.0.0', [nested]);
        const root = new Command('vendure');
        registerManifestCommands(root, mergeManifests([built]), { loadDefinitions: async () => [] });
        const brand = root.commands.find(c => c.name() === 'brand') as Command;
        expect(brand.commands[0].name()).toBe('new');
        expect(brand.commands[0].commands[0].name()).toBe('cmd');
    });

    it('registers every field as an optional flag, never as a required one', async () => {
        const root = await program();
        const thing = (root.commands.find(c => c.name() === 'add') as Command).commands[0];
        const flags = thing.options.map(o => o.flags);
        expect(flags).toEqual([
            '-n, --name <name>',
            '--tags <tags...>',
            '--size <size>',
            '--dry-run',
            '--kind <kind>',
            '--overwrite <digest>',
            '--json',
            '--input <json|->',
            '--format <type>',
        ]);
        expect(thing.options.some(o => o.mandatory)).toBe(false);
        expect(thing.registeredArguments).toHaveLength(0);
    });

    it('parses flags without the host being involved', async () => {
        const root = await program();
        const thing = (root.commands.find(c => c.name() === 'add') as Command).commands[0];
        thing.action(() => undefined);
        await root
            .parseAsync(
                [
                    'add',
                    'thing',
                    '-n',
                    'x',
                    '--size',
                    '3',
                    '--tags',
                    'a',
                    'b',
                    '--dry-run',
                    '--overwrite',
                    'digest',
                ],
                { from: 'user' },
            )
            .catch(() => undefined);
        expect(thing.opts()).toMatchObject({
            name: 'x',
            size: 3,
            tags: ['a', 'b'],
            dryRun: true,
            overwrite: 'digest',
        });
    });
});

describe('jsonRequested', () => {
    it('is true for --json, --format json and --format=json', () => {
        expect(jsonRequested(['doctor', '--json'])).toBe(true);
        expect(jsonRequested(['doctor', '--format', 'json'])).toBe(true);
        expect(jsonRequested(['doctor', '--format=json'])).toBe(true);
    });

    it('is false otherwise, and ignores what follows --', () => {
        expect(jsonRequested(['doctor'])).toBe(false);
        expect(jsonRequested(['doctor', '--format', 'text'])).toBe(false);
        expect(jsonRequested(['doctor', '--', '--json'])).toBe(false);
    });
});
