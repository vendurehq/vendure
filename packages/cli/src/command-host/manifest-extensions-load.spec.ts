import { buildCommandManifest, CommandManifest } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';

import { explainDefinition } from '../commands/explain/explain.command.js';

import { droppedExtensionInput, findMismatch } from './commander-adapter.js';
import { mergeProjectManifests } from './manifest.js';
import { testCommand } from './test-command.js';

/** A Standard Schema object schema written out in a module, so the module imports nothing. */
const SCHEMA = `
function objectSchema(properties) {
    const json = { type: 'object', properties };
    return {
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: value => ({
                value: Object.fromEntries(Object.entries(value ?? {}).filter(([field]) => field in properties)),
            }),
            jsonSchema: { input: () => json, output: () => json },
        },
    };
}
`;

const TOOLS = `${SCHEMA}
export const commands = [
    {
        path: ['tools', 'sync'],
        description: 'Sync',
        behavior: 'readonly',
        cli: { fields: { trace: { internal: true } } },
        schemas: async () => ({ input: objectSchema({ target: { type: 'string' }, trace: { type: 'string' } }) }),
        run: async () => ({ run: async input => ({ ran: input }) }),
    },
];
`;

const CLOUD = `${SCHEMA}
export const commands = [];
export const extensions = [
    {
        path: ['tools', 'sync'],
        schemas: async () => ({ input: objectSchema({ trace: { type: 'string' } }) }),
        run: async () => ({ run: async (_input, _ctx, next) => next() }),
    },
];
`;

describe('extensions that clash with an internal field, or fail to load', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-extension-load-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    async function toolsAndCloud(): Promise<{ tools: CommandManifest; cloud: CommandManifest }> {
        fs.writeFileSync(path.join(dir, 'tools.mjs'), TOOLS);
        fs.writeFileSync(path.join(dir, 'cloud.mjs'), CLOUD);
        const toolsModule = await import(pathToFileURL(path.join(dir, 'tools.mjs')).href);
        const cloudModule = await import(pathToFileURL(path.join(dir, 'cloud.mjs')).href);
        return {
            tools: await buildCommandManifest('@acme/tools', '1.0.0', toolsModule.commands),
            cloud: await buildCommandManifest('@acme/cloud', '1.0.0', [], {
                extensions: cloudModule.extensions,
            }),
        };
    }

    /** The command of that path, or a failed test. */
    function commandAt<T extends { path: string[] }>(commands: T[], key: string): T {
        const command = commands.find(candidate => candidate.path.join(' ') === key);
        if (!command) {
            throw new Error(`There is no command "${key}"`);
        }
        return command;
    }

    function merge(tools: CommandManifest, cloud: CommandManifest, core?: CommandManifest) {
        return mergeProjectManifests(
            core ?? { manifestVersion: 1, package: '@vendure/cli', version: '4.0.0', commands: [] },
            [
                {
                    packageName: '@acme/tools',
                    manifest: tools,
                    definitionsPath: path.join(dir, 'tools.mjs'),
                    scope: 'project',
                },
                {
                    packageName: '@acme/cloud',
                    manifest: cloud,
                    definitionsPath: path.join(dir, 'cloud.mjs'),
                    scope: 'project',
                },
            ],
        );
    }

    it('refuses an extension field that is an internal field of the command when the manifests merge', async () => {
        const { tools, cloud } = await toolsAndCloud();

        const { commands, refused } = merge(tools, cloud);

        expect(tools.commands[0].cli.internalFields).toEqual(['trace']);
        expect(refused).toEqual([
            {
                package: '@acme/cloud',
                error: expect.objectContaining({
                    code: 'plugin.extension-clash',
                    message: expect.stringContaining(
                        'the input field "trace" of "tools sync" is an internal field of the command',
                    ),
                }),
                kind: 'extensions',
            },
        ]);
        const sync = commandAt(commands, 'tools sync');
        expect(sync.extendedBy).toBeUndefined();
        expect(Object.keys(sync.input.properties as object)).toEqual(['target']);
    });

    it('refuses the run, and leaves the manifest entry as it is, for an old manifest that missed the clash', async () => {
        const { tools, cloud } = await toolsAndCloud();
        // A manifest built before the command listed its internal fields.
        delete tools.commands[0].cli.internalFields;
        const merged = merge(tools, cloud);
        expect(merged.refused).toEqual([]);
        const sync = commandAt(merged.commands, 'tools sync');
        const before = structuredClone(sync);

        const loaded = await merged.loadCommand(sync);

        expect(loaded.mismatch).toBe(
            'the extension from @acme/cloud breaks a rule: the input field "trace" of "tools sync" is an internal field of the command',
        );
        expect(sync).toEqual(before);
    });

    it('runs a command without an extension whose run module throws on import, and lists it', async () => {
        fs.writeFileSync(
            path.join(dir, 'run-broken.mjs'),
            `${SCHEMA}
export const commands = [];
export const extensions = [
    {
        path: ['explain'],
        schemas: async () => ({ input: objectSchema({ shout: { type: 'boolean' } }) }),
        run: async () => {
            throw new Error('run module broken on import');
        },
    },
];
`,
        );
        const declared = await import(pathToFileURL(path.join(dir, 'run-broken.mjs')).href);
        const core = await buildCommandManifest('@vendure/cli', '4.0.0', [explainDefinition]);
        const merged = mergeProjectManifests(core, [
            {
                packageName: '@acme/run-broken',
                manifest: await buildCommandManifest('@acme/run-broken', '1.0.0', [], {
                    extensions: declared.extensions,
                }),
                definitionsPath: path.join(dir, 'run-broken.mjs'),
                scope: 'project',
            },
        ]);

        const loaded = await merged.loadCommand(commandAt(merged.commands, 'explain'));

        expect(loaded.definition).toBe(explainDefinition);
        expect(loaded.dropped).toEqual([
            expect.objectContaining({
                package: '@acme/run-broken',
                reason: 'run module broken on import',
                error: expect.objectContaining({ code: 'plugin.extension-failed' }),
            }),
        ]);
    });

    it('runs a command of the CLI without an extension whose module throws on import, and lists it', async () => {
        fs.writeFileSync(path.join(dir, 'broken.mjs'), "throw new Error('broken on import');\n");
        const core = await buildCommandManifest('@vendure/cli', '4.0.0', [explainDefinition]);
        const broken = await buildCommandManifest('@acme/broken', '1.0.0', [], {
            extensions: [
                {
                    path: ['explain'],
                    schemas: () => Promise.resolve({ input: z.object({ shout: z.boolean().optional() }) }),
                    run: () => Promise.resolve({ run: (_input, _ctx, next) => next() }),
                },
            ],
        });
        const merged = mergeProjectManifests(core, [
            {
                packageName: '@acme/broken',
                manifest: broken,
                definitionsPath: path.join(dir, 'broken.mjs'),
                scope: 'project',
            },
        ]);
        expect(merged.refused).toEqual([]);
        const explain = commandAt(merged.commands, 'explain');
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const loaded = await merged.loadCommand(explain);
        const definition = loaded.definition;
        if (!definition) {
            throw new Error('The command did not load');
        }

        // The run reports it, as a notice of its envelope, so loading it writes nothing itself.
        expect(stderr).not.toHaveBeenCalled();
        expect(definition).toBe(explainDefinition);
        expect(loaded.dropped).toEqual([
            {
                package: '@acme/broken',
                fields: ['shout'],
                reason: expect.stringContaining('broken on import'),
                error: expect.objectContaining({
                    code: 'plugin.extension-failed',
                    message: expect.stringContaining(
                        'The extension of "explain" from @acme/broken failed to load',
                    ),
                }),
            },
        ]);
        expect(explain.extendedBy).toEqual([{ package: '@acme/broken', fields: ['shout'] }]);
        expect(loaded.manifestCommand.extendedBy).toEqual([]);
        expect(await findMismatch(definition, loaded.manifestCommand)).toBeUndefined();
        expect(droppedExtensionInput(loaded, { requestId: 'abc' })).toBeUndefined();
        expect(
            droppedExtensionInput(loaded, { requestId: 'abc', shout: true })?.envelope.error,
        ).toMatchObject({
            code: 'cli.usage',
            message: expect.stringContaining(
                '--shout comes from @acme/broken, whose extension of "explain" failed to load',
            ),
        });

        const result = await testCommand(definition, { requestId: 'abc' }, { cwd: dir });
        expect(result.envelope.error?.code).toBe('devserver.project-not-found');
    });

    // Each extension wraps those enabled before it, as `extendCommands` wrappers do.
    it('runs the extension of the last enabled package outermost', async () => {
        const wrapper = (name: string, field: string) => `${SCHEMA}
export const commands = [];
export const extensions = [
    {
        path: ['tools', 'sync'],
        schemas: async () => ({ input: objectSchema({ ${field}: { type: 'string' } }) }),
        run: async () => ({
            run: async (_input, _ctx, next) => {
                globalThis.__extensionOrder.push('${name} before');
                const output = await next();
                globalThis.__extensionOrder.push('${name} after');
                return output;
            },
        }),
    },
];
`;
        const order: string[] = [];
        (globalThis as { __extensionOrder?: string[] }).__extensionOrder = order;
        onTestFinished(() => {
            delete (globalThis as { __extensionOrder?: string[] }).__extensionOrder;
        });
        fs.writeFileSync(path.join(dir, 'tools.mjs'), TOOLS);
        fs.writeFileSync(path.join(dir, 'first.mjs'), wrapper('first', 'alpha'));
        fs.writeFileSync(path.join(dir, 'second.mjs'), wrapper('second', 'beta'));
        const load = async (name: string) => import(pathToFileURL(path.join(dir, `${name}.mjs`)).href);
        const [toolsModule, firstModule, secondModule] = await Promise.all(
            ['tools', 'first', 'second'].map(load),
        );
        const tools = await buildCommandManifest('@acme/tools', '1.0.0', toolsModule.commands);
        const enabled = await Promise.all(
            [
                ['@acme/first', 'first', firstModule],
                ['@acme/second', 'second', secondModule],
            ].map(async ([packageName, file, module]) => ({
                packageName,
                manifest: await buildCommandManifest(packageName, '1.0.0', [], {
                    extensions: module.extensions,
                }),
                definitionsPath: path.join(dir, `${file}.mjs`),
                scope: 'project' as const,
            })),
        );
        const merged = mergeProjectManifests(
            { manifestVersion: 1, package: '@vendure/cli', version: '4.0.0', commands: [] },
            [
                {
                    packageName: '@acme/tools',
                    manifest: tools,
                    definitionsPath: path.join(dir, 'tools.mjs'),
                    scope: 'project',
                },
                ...enabled,
            ],
        );
        expect(merged.refused).toEqual([]);

        const loaded = await merged.loadCommand(commandAt(merged.commands, 'tools sync'));
        if (!loaded.definition) {
            throw new Error('The command did not load');
        }
        const result = await testCommand(loaded.definition, { target: 'x' }, { cwd: dir });

        expect(result.envelope.error).toBeUndefined();
        expect(order).toEqual(['second before', 'first before', 'first after', 'second after']);
    });
});
