import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineCommandExtension, defineError } from '../define';
import { JsonSchema, StandardSchema } from '../types';

import { buildCommandManifest, writeCommandManifest } from './build';
import { MANIFEST_FILE_NAME, readManifestFile } from './manifest';

interface TestSchema extends StandardSchema {
    calls: Array<{ side: 'input' | 'output'; target: string }>;
}

/**
 * A schema that implements only the Standard Schema interface, as Zod v4 does. The builder must
 * work through that interface alone, so this package needs no schema library. Each side returns
 * its own JSON Schema, as a Zod schema with a transform or a default does.
 */
function schema(input: JsonSchema, output: JsonSchema): TestSchema {
    const calls: TestSchema['calls'] = [];
    return {
        calls,
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: value => ({ value }),
            jsonSchema: {
                input: ({ target }) => {
                    calls.push({ side: 'input', target });
                    return input;
                },
                output: ({ target }) => {
                    calls.push({ side: 'output', target });
                    return output;
                },
            },
        },
    };
}

function wipeCommand() {
    const input = schema(
        {
            type: 'object',
            properties: { name: { type: 'string' }, force: { type: 'boolean' } },
            required: ['name'],
        },
        { title: 'the output side of the input schema' },
    );
    const output = schema(
        { title: 'the input side of the output schema' },
        { type: 'object', properties: { wiped: { type: 'boolean' } } },
    );
    const events = schema(
        { title: 'the input side of the events schema' },
        { type: 'object', properties: { type: { const: 'wiping' } } },
    );
    const command = defineCommand({
        path: ['demo', 'wipe'],
        description: 'Wipe the demo',
        behavior: 'destructive',
        consents: { wipeData: 'Wipes the data' },
        schemas: () => Promise.resolve({ input, output, events }),
        cli: { fields: { name: { choices: () => Promise.resolve(['a']) } } },
        plan: () =>
            Promise.resolve({
                plan: () => Promise.resolve({ preview: {}, requiredConsents: ['wipeData'] }),
            }),
        run: () => Promise.resolve({ run: () => Promise.resolve({ wiped: true }) }),
    });
    return { command, input, output, events };
}

describe('buildCommandManifest', () => {
    it('turns the schemas into JSON Schema and adds a field for each consent', async () => {
        const { command } = wipeCommand();
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [command]);
        const [wipe] = built.commands;
        expect(wipe.input.required).toEqual(['name']);
        expect(Object.keys(wipe.input.properties as object)).toEqual(['name', 'force', 'wipeData']);
        expect((wipe.input.properties as any).wipeData.type).toBe('string');
        expect((wipe.output as any).properties.wiped.type).toBe('boolean');
        expect((wipe.events as any).properties.type.const).toBe('wiping');
        expect(wipe.hasPlan).toBe(true);
        expect(wipe.cli.fields?.name).toMatchObject({ hasChoices: true });
    });

    it('lists the secret output fields, and leaves the field out when there are none', async () => {
        const { command } = wipeCommand();
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [
            command,
            { ...command, path: ['demo', 'key'], secretOutputs: ['wiped'] },
        ]);
        expect(built.commands[0]).not.toHaveProperty('secretOutputs');
        expect(built.commands[1].secretOutputs).toEqual(['wiped']);
    });

    it('fails the build for a secret output that is not a field of the output', async () => {
        const { command } = wipeCommand();
        await expect(
            buildCommandManifest('@vendure/cli', '1.0.0', [{ ...command, secretOutputs: ['apiKey'] }]),
        ).rejects.toThrow('not top-level fields of its output schema: apiKey');
    });

    it('fails the build for secret outputs on a command without an output schema', async () => {
        const { command, input } = wipeCommand();
        await expect(
            buildCommandManifest('@vendure/cli', '1.0.0', [
                { ...command, secretOutputs: ['key'], schemas: () => Promise.resolve({ input }) },
            ]),
        ).rejects.toThrow('not top-level fields');
    });

    it('describes a secret output field as the value or the file it was written to', async () => {
        const { command } = wipeCommand();
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [
            { ...command, secretOutputs: ['wiped'] },
        ]);
        const wiped = (built.commands[0].output as any).properties.wiped;
        expect(wiped.anyOf[0].type).toBe('boolean');
        expect(wiped.anyOf[1]).toMatchObject({ type: 'object', required: ['secretFile'] });
    });

    // A caller sends the input, and receives the output and the events.
    it('converts the input side of the input schema, and the output side of the others', async () => {
        const { command, input, output, events } = wipeCommand();
        await buildCommandManifest('@vendure/cli', '1.0.0', [command]);
        expect(input.calls).toEqual([{ side: 'input', target: 'draft-2020-12' }]);
        expect(output.calls).toEqual([{ side: 'output', target: 'draft-2020-12' }]);
        expect(events.calls).toEqual([{ side: 'output', target: 'draft-2020-12' }]);
    });

    it('does not put functions into the manifest', async () => {
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [wipeCommand().command]);
        expect(JSON.parse(JSON.stringify(built))).toEqual(built);
    });

    it('refuses a declaration the host would refuse', async () => {
        const reserved = defineCommand({ ...wipeCommand().command, path: ['admin', 'wipe'] });
        await expect(buildCommandManifest('@a/one', '1.0.0', [reserved])).rejects.toThrow(/reserved/);
    });

    it('leaves out a field marked internal, which only an extension sets, and lists its name', async () => {
        const { command } = wipeCommand();
        const manifest = await buildCommandManifest('@a/one', '1.0.0', [
            { ...command, cli: { fields: { force: { internal: true } } } },
        ]);

        expect(Object.keys(manifest.commands[0].input.properties as object)).toEqual(['name', 'wipeData']);
        expect(manifest.commands[0].cli.fields).toEqual({});
        expect(manifest.commands[0].cli.internalFields).toEqual(['force']);
    });

    it('writes the extensions of commands, with their consents, errors and CLI metadata', async () => {
        const manifest = await buildCommandManifest('@a/cloud', '1.0.0', [], {
            extensions: [
                defineCommandExtension({
                    path: ['dev'],
                    consents: { deployPreview: 'Deploy a preview' },
                    errors: [defineError({ code: 'cloud.not-linked', exit: 2, message: () => 'not linked' })],
                    cli: { flags: { project: { short: '-p' } } },
                    schemas: () =>
                        Promise.resolve({
                            input: schema(
                                {
                                    type: 'object',
                                    properties: { project: { type: 'string' } },
                                    required: ['project'],
                                },
                                {},
                            ),
                            output: schema(
                                {},
                                { type: 'object', properties: { previewUrl: { type: 'string' } } },
                            ),
                        }),
                    run: () => Promise.resolve({ run: (_input, _ctx, next) => next() }),
                }),
            ],
        });

        expect(manifest.commands).toEqual([]);
        expect(manifest.extensions).toEqual([
            {
                path: ['dev'],
                input: {
                    type: 'object',
                    properties: {
                        project: { type: 'string' },
                        deployPreview: {
                            type: 'string',
                            description: 'The digest of the preview for this consent: Deploy a preview',
                        },
                    },
                    required: ['project'],
                },
                output: { type: 'object', properties: { previewUrl: { type: 'string' } } },
                consents: { deployPreview: 'Deploy a preview' },
                errors: [{ code: 'cloud.not-linked', exit: 2 }],
                cli: { flags: { project: { short: '-p' } }, fields: {} },
            },
        ]);
    });

    it("refuses an extension that marks its own field internal, or has CLI metadata for another's", async () => {
        const project = () =>
            Promise.resolve({
                input: schema({ type: 'object', properties: { project: { type: 'string' } } }, {}),
            });
        const run = () =>
            Promise.resolve({ run: (_input: unknown, _ctx: unknown, next: () => any) => next() });

        await expect(
            buildCommandManifest('@a/cloud', '1.0.0', [], {
                extensions: [
                    defineCommandExtension({
                        path: ['dev'],
                        cli: { fields: { project: { internal: true } } },
                        schemas: project,
                        run,
                    }),
                ],
            }),
        ).rejects.toThrow('marks its own field "project" internal');
        await expect(
            buildCommandManifest('@a/cloud', '1.0.0', [], {
                extensions: [
                    defineCommandExtension({
                        path: ['dev'],
                        cli: { flags: { inspect: { short: '-i' } } },
                        schemas: project,
                        run,
                    }),
                ],
            }),
        ).rejects.toThrow('its CLI metadata names "inspect", which is not one of its fields');
    });

    it('refuses an extension that uses a field name the host reserves', async () => {
        const reserved = defineCommandExtension({
            path: ['dev'],
            schemas: () =>
                Promise.resolve({
                    input: schema({ type: 'object', properties: { json: { type: 'boolean' } } }, {}),
                }),
            run: () => Promise.resolve({ run: (_input, _ctx, next) => next() }),
        });
        await expect(
            buildCommandManifest('@a/cloud', '1.0.0', [], { extensions: [reserved] }),
        ).rejects.toThrow(/"json", which the host reserves/);
    });

    it('refuses a command or an extension with a consent named like one of its own fields', async () => {
        const { command } = wipeCommand();
        await expect(
            buildCommandManifest('@a/one', '1.0.0', [{ ...command, consents: { force: 'Force it' } }]),
        ).rejects.toThrow(
            '@a/one declares the command "demo wipe" with the consent "force", which is also one of its input fields',
        );
        const extension = defineCommandExtension({
            path: ['dev'],
            consents: { region: 'Deploy to this region' },
            schemas: () =>
                Promise.resolve({
                    input: schema({ type: 'object', properties: { region: { type: 'string' } } }, {}),
                }),
            run: () => Promise.resolve({ run: (_input, _ctx, next) => next() }),
        });
        await expect(
            buildCommandManifest('@a/cloud', '1.0.0', [], { extensions: [extension] }),
        ).rejects.toThrow(
            'The extension of "dev" with the consent "region", which is also one of its input fields',
        );
    });
});

describe('writeCommandManifest', () => {
    it('writes a manifest that readManifestFile reads back', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-manifest-'));
        try {
            const command = defineCommand({
                path: ['demo'],
                description: 'Demo',
                behavior: 'readonly',
                schemas: () => Promise.resolve({ input: schema({ type: 'object', properties: {} }, {}) }),
                run: () => Promise.resolve({ run: () => Promise.resolve({}) }),
            });
            const file = await writeCommandManifest(dir, '@a/one', '1.2.3', [command]);
            expect(file).toBe(path.join(dir, MANIFEST_FILE_NAME));
            const read = readManifestFile(file);
            expect(read.package).toBe('@a/one');
            expect(read.commands.map(c => c.path)).toEqual([['demo']]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
