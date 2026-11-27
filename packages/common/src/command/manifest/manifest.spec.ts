import { describe, expect, it } from 'vitest';

import { CommandManifest, ManifestCommand, mergeManifests } from './manifest';

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

    it.each(['json', 'input', 'format', 'yes'])('refuses a field named "%s"', name => {
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

    it('refuses an error code that is not namespace.kebab-name', () => {
        expect(() =>
            mergeManifests([manifest('@a/one', entry(['x'], { errors: [{ code: 'NotFound', exit: 1 }] }))]),
        ).toThrow(/@a\/one declares the command "x" with the error code "NotFound"/);
        expect(
            mergeManifests([
                manifest('@a/one', entry(['x'], { errors: [{ code: 'a.not-found', exit: 1 }] })),
            ]),
        ).toHaveLength(1);
    });
});
