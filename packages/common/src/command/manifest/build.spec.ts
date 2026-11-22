import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { defineCommand } from '../define';
import { JsonSchema, StandardSchema } from '../types';

import { buildCommandManifest, writeCommandManifest } from './build';
import { MANIFEST_FILE_NAME, readManifestFile } from './manifest';

/**
 * A schema that implements only the Standard Schema interface, as Zod v4 does. The builder must
 * work through that interface alone, so this package needs no schema library.
 */
function schema(input: JsonSchema, output: JsonSchema = input): StandardSchema & { targets: string[] } {
    const targets: string[] = [];
    return {
        targets,
        '~standard': {
            version: 1,
            vendor: 'test',
            validate: value => ({ value }),
            jsonSchema: {
                input: ({ target }) => {
                    targets.push(target);
                    return input;
                },
                output: ({ target }) => {
                    targets.push(target);
                    return output;
                },
            },
        },
    };
}

describe('buildCommandManifest', () => {
    const input = schema({
        type: 'object',
        properties: { name: { type: 'string' }, force: { type: 'boolean' } },
        required: ['name'],
    });
    const output = schema({ type: 'object', properties: { wiped: { type: 'boolean' } } });
    const command = defineCommand({
        path: ['demo', 'wipe'],
        description: 'Wipe the demo',
        behavior: 'destructive',
        consents: { wipeData: 'Wipes the data' },
        schemas: () => Promise.resolve({ input, output }),
        cli: { fields: { name: { choices: () => Promise.resolve(['a']) } } },
        plan: () =>
            Promise.resolve({
                plan: () => Promise.resolve({ preview: {}, requiredConsents: ['wipeData'] }),
            }),
        run: () => Promise.resolve({ run: () => Promise.resolve({ wiped: true }) }),
    });

    it('turns the schemas into JSON Schema and adds a field for each consent', async () => {
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [command]);
        const [wipe] = built.commands;
        expect(input.targets).toContain('draft-2020-12');
        expect(wipe.input.required).toEqual(['name']);
        expect(Object.keys(wipe.input.properties as object)).toEqual(['name', 'force', 'wipeData']);
        expect((wipe.input.properties as any).wipeData.type).toBe('string');
        expect((wipe.output as any).properties.wiped.type).toBe('boolean');
        expect(wipe.hasPlan).toBe(true);
        expect(wipe.cli.fields?.name).toMatchObject({ hasChoices: true });
    });

    it('does not put functions into the manifest', async () => {
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [command]);
        expect(JSON.parse(JSON.stringify(built))).toEqual(built);
    });

    it('refuses a declaration the host would refuse', async () => {
        const reserved = defineCommand({ ...command, path: ['admin', 'wipe'] });
        await expect(buildCommandManifest('@a/one', '1.0.0', [reserved])).rejects.toThrow(/reserved/);
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
                schemas: () => Promise.resolve({ input: schema({ type: 'object', properties: {} }) }),
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
