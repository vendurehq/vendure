import { defineCommand } from '@vendure/common/lib/command';
import { buildCommandManifest, mergeManifests } from '@vendure/common/lib/command/manifest';
import { Command } from 'commander';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
    CancellationSource,
    createCancellation,
    findMismatch,
    jsonRequested,
    registerManifestCommands,
} from './commander-adapter.js';

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
    plan: async () => ({ plan: async () => ({ preview: {}, requiredConsents: [] }) }),
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
        await root.parseAsync(
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
        );
        expect(thing.opts()).toMatchObject({
            name: 'x',
            size: 3,
            tags: ['a', 'b'],
            dryRun: true,
            overwrite: 'digest',
        });
    });
});

describe('positional fields', () => {
    const positional = defineCommand({
        path: ['show'],
        description: 'Shows a thing',
        behavior: 'readonly',
        schemas: async () => ({ input: z.object({ id: z.string().describe('The id') }) }),
        cli: { positional: ['id'] },
        run: async () => ({ run: async () => ({}) }),
    });

    // A fix or a need names every field as a flag, so a positional field takes one too.
    it('registers a positional field as an argument and as a flag', async () => {
        const built = await buildCommandManifest('@test/pkg', '1.0.0', [positional]);
        const root = new Command('vendure').exitOverride();
        registerManifestCommands(root, mergeManifests([built]), {
            loadDefinitions: async () => [positional],
        });
        const show = root.commands.find(c => c.name() === 'show') as Command;
        expect(show.registeredArguments.map(a => a.name())).toEqual(['id']);
        expect(show.options.map(o => o.flags)).toContain('--id <id>');
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

describe('createCancellation', () => {
    function fakeProcess(withIpc: boolean) {
        const events = new EventEmitter();
        const exit = vi.fn();
        const source = {
            on: (event: string, listener: (message?: unknown) => void) => events.on(event, listener),
            send: withIpc ? () => true : undefined,
            channel: null,
            exit,
        } as unknown as CancellationSource;
        return { events, exit, source };
    }

    it('aborts on the first SIGINT, and ends the process on a later second one', () => {
        vi.useFakeTimers();
        try {
            const { events, exit, source } = fakeProcess(false);
            const controller = createCancellation(source);
            events.emit('SIGINT');
            expect(controller.signal.aborted).toBe(true);
            events.emit('SIGINT');
            expect(exit).not.toHaveBeenCalled();
            vi.advanceTimersByTime(600);
            events.emit('SIGINT');
            expect(exit).toHaveBeenCalledWith(130);
        } finally {
            vi.useRealTimers();
        }
    });

    // `vendure mcp` sends the message, then SIGINT to the process group a little later, so that
    // the processes the command started stop too. The signal must not cut the command short.
    it('does not end the process on the SIGINT that follows a cancel over IPC', () => {
        vi.useFakeTimers();
        try {
            const { events, exit, source } = fakeProcess(true);
            const controller = createCancellation(source);
            events.emit('message', { type: 'cancel' });
            expect(controller.signal.aborted).toBe(true);
            vi.advanceTimersByTime(2_000);
            events.emit('SIGINT');
            events.emit('SIGINT');
            expect(exit).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('findMismatch', () => {
    it('accepts the declaration a manifest was built from', async () => {
        const [built] = mergeManifests([await buildCommandManifest('@test/pkg', '1.0.0', [demo])]);
        expect(await findMismatch(demo, built)).toBeUndefined();
    });

    // `watch` leaves an old manifest in place while the declarations change.
    it('reports an input field that the manifest does not list', async () => {
        const [built] = mergeManifests([await buildCommandManifest('@test/pkg', '1.0.0', [demo])]);
        const changed = defineCommand({
            ...demo,
            schemas: async () => ({ input: z.object({ name: z.string(), colour: z.string().optional() }) }),
        });
        expect(await findMismatch(changed, built)).toBe('its input fields differ');
    });
});
