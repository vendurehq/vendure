import { defineCommand } from '@vendure/common/lib/command';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { consentDigest } from './digest.js';
import { buildCommandManifest } from './manifest-build.js';
import { CommandManifest, loadMergedManifest, ManifestCommand, mergeManifests } from './manifest.js';

function entry(path: string[], overrides: Partial<ManifestCommand> = {}): ManifestCommand {
    return {
        path,
        description: path.join(' '),
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
        ...overrides,
    };
}

function manifest(pkg: string, ...commands: ManifestCommand[]): CommandManifest {
    return { manifestVersion: 1, package: pkg, version: '1.0.0', commands };
}

describe('mergeManifests', () => {
    it('merges the commands of several packages and records the source', () => {
        const merged = mergeManifests([
            manifest('@a/one', entry(['one'])),
            manifest('@b/two', entry(['two', 'sub'])),
        ]);
        expect(merged.map(c => [c.path.join(' '), c.source])).toEqual([
            ['one', '@a/one'],
            ['two sub', '@b/two'],
        ]);
    });

    it('refuses a path that two packages declare', () => {
        expect(() =>
            mergeManifests([manifest('@a/one', entry(['x'])), manifest('@b/two', entry(['x']))]),
        ).toThrow(/"x" is declared by both @a\/one and @b\/two/);
    });

    it.each(['admin', 'shop'])('refuses a path that starts with the reserved word "%s"', word => {
        expect(() => mergeManifests([manifest('@a/one', entry([word, 'list']))])).toThrow(/reserved/);
    });

    it.each(['json', 'input', 'yes', 'project'])('refuses a field named "%s"', name => {
        expect(() =>
            mergeManifests([
                manifest('@a/one', entry(['x'], { input: { properties: { [name]: { type: 'string' } } } })),
            ]),
        ).toThrow(/reserves/);
    });

    // `add_codegen` and `add codegen` would both be the MCP tool `add_codegen`.
    it.each([['add_codegen'], ['Add'], ['']])('refuses the path segment %j', segment => {
        expect(() => mergeManifests([manifest('@a/one', entry([segment]))])).toThrow(
            /is not a lowercase word/,
        );
    });

    it('refuses two fields that share a short flag', () => {
        expect(() =>
            mergeManifests([
                manifest(
                    '@a/one',
                    entry(['x'], { cli: { flags: { alpha: { short: '-a' }, beta: { short: '-a' } } } }),
                ),
            ]),
        ).toThrow(/short flag -a/);
    });
});

describe('buildCommandManifest', () => {
    const command = defineCommand({
        path: ['demo', 'wipe'],
        description: 'Wipe the demo',
        behavior: 'destructive',
        consents: { wipeData: 'Wipes the data' },
        schemas: async () => ({
            input: z.object({ name: z.string(), force: z.boolean().optional() }),
            output: z.object({ wiped: z.boolean() }),
        }),
        cli: { fields: { name: { choices: async () => ['a'] } } },
        plan: async () => ({ plan: async () => ({ preview: {}, requiredConsents: ['wipeData'] }) }),
        run: async () => ({ run: async () => ({ wiped: true }) }),
    });

    it('turns the schemas into JSON Schema and adds a field for each consent', async () => {
        const built = await buildCommandManifest('@vendure/cli', '1.0.0', [command]);
        const [wipe] = built.commands;
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
});

describe('consentDigest', () => {
    it('does not depend on the order of keys', () => {
        expect(consentDigest('c', { a: 1, b: { c: 2, d: 3 } })).toBe(
            consentDigest('c', { b: { d: 3, c: 2 }, a: 1 }),
        );
    });

    it('differs when the preview or the consent differs', () => {
        expect(consentDigest('c', { a: 1 })).not.toBe(consentDigest('c', { a: 2 }));
        expect(consentDigest('c', { a: 1 })).not.toBe(consentDigest('d', { a: 1 }));
    });
});

describe('loadMergedManifest', () => {
    // `watch` compiles without writing the manifest, so a fresh `dist` from `watch` has none.
    it('builds the manifest from the declarations when the file is missing', async () => {
        const merged = await loadMergedManifest('/nonexistent/vendure-commands.json');
        expect(merged.map(command => command.path.join(' ')).sort()).toEqual([
            'add codegen',
            'commands',
            'doctor',
            'migrate revert',
        ]);
        expect(merged[0].source).toBe('@vendure/cli');
    });
});
