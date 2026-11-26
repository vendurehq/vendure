import type { CommandManifest, ManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedCommandManifest } from '../shared/resolve-cli-plugins.js';

import { consentDigest } from './digest.js';
import { loadMergedManifest, loadProjectCommands, mergeProjectManifests } from './manifest.js';

describe('consentDigest', () => {
    it('does not depend on the order of keys', () => {
        expect(consentDigest('c', { a: 1, b: { c: 2, d: 3 } })).toBe(
            consentDigest('c', { b: { d: 3, c: 2 }, a: 1 }),
        );
    });

    // A caller passes a digest from one process to another, so it must not depend on the locale.
    // Keys are ordered by code unit: "Z" before "a", and "é" last.
    it('gives the same digest in every process', () => {
        expect(consentDigest('revertMigration', { b: 1, a: 'é', Z: [2, { y: null, x: true }] })).toBe(
            '6a11e240efbb7810',
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
        const merged = await loadMergedManifest({
            coreManifestFile: '/nonexistent/vendure-commands.json',
            plugins: [],
        });
        expect(merged.map(command => command.path.join(' ')).sort()).toEqual([
            'add api-extension',
            'add codegen',
            'add dashboard',
            'add entity',
            'add job-queue',
            'add plugin',
            'add service',
            'api',
            'auth login',
            'auth logout',
            'auth status',
            'auth wait',
            'commands',
            'console link',
            'console status',
            'console unlink',
            'dev',
            'devserver logs',
            'devserver start',
            'devserver status',
            'devserver stop',
            'devserver wait',
            'doctor',
            'explain',
            'guide',
            'mcp install',
            'migrate generate',
            'migrate revert',
            'migrate run',
            'seed',
            'store check',
        ]);
        expect(merged[0].source).toBe('@vendure/cli');
    });
});

function manifestCommand(commandPath: string[]): ManifestCommand {
    return {
        path: commandPath,
        description: `The ${commandPath.join(' ')} command`,
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
    };
}

function manifest(packageName: string, ...paths: string[][]): CommandManifest {
    return {
        manifestVersion: 1,
        package: packageName,
        version: '1.0.0',
        commands: paths.map(manifestCommand),
    };
}

function plugin(packageName: string, ...paths: string[][]): ResolvedCommandManifest {
    return {
        packageName,
        manifest: manifest(packageName, ...paths),
        definitionsPath: `/plugins/${packageName}/commands.js`,
        scope: 'project',
    };
}

const core = manifest('@vendure/cli', ['doctor'], ['auth', 'login'], ['migrate', 'generate']);

describe('mergeProjectManifests', () => {
    it("adds a plugin's commands after the CLI's own, with the plugin as their source", () => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin('acme-cli', ['acme', 'sync'], ['acme', 'status']),
        ]);
        expect(refused).toEqual([]);
        expect(commands.map(c => [c.path.join(' '), c.source])).toEqual([
            ['doctor', '@vendure/cli'],
            ['auth login', '@vendure/cli'],
            ['migrate generate', '@vendure/cli'],
            ['acme sync', 'acme-cli'],
            ['acme status', 'acme-cli'],
        ]);
    });

    it('lets a plugin add a command to a group that already exists', () => {
        const { commands, refused } = mergeProjectManifests(core, [plugin('acme-cli', ['auth', 'acme'])]);
        expect(refused).toEqual([]);
        expect(commands.map(c => c.path.join(' '))).toContain('auth acme');
    });

    it.each([
        ['the same path as a core command', ['doctor'], 'the command "doctor" of @vendure/cli'],
        ['a path under a core command', ['doctor', 'deep'], 'the command "doctor" of @vendure/cli'],
        ['the path of a core group', ['auth'], 'the command "auth login" of @vendure/cli'],
    ])('refuses a plugin that declares %s, with a coded error', (_, clashing, other) => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin('acme-cli', ['acme', 'sync'], clashing),
        ]);
        expect(refused).toEqual([
            {
                package: 'acme-cli',
                error: {
                    code: 'plugin.command-clash',
                    exit: 1,
                    message: expect.stringContaining(`"${clashing.join(' ')}", which clashes with ${other}`),
                },
            },
        ]);
        // The whole plugin is refused, and the CLI's own commands stay.
        expect(commands.map(c => c.source)).toEqual(['@vendure/cli', '@vendure/cli', '@vendure/cli']);
    });

    it('refuses the second of two plugins that declare the same command, and keeps the first', () => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin('first-cli', ['sync']),
            plugin('second-cli', ['sync'], ['other']),
        ]);
        expect(commands.filter(c => c.source !== '@vendure/cli').map(c => c.source)).toEqual(['first-cli']);
        expect(refused).toHaveLength(1);
        expect(refused[0].package).toBe('second-cli');
        expect(refused[0].error.message).toContain('the command "sync" of first-cli');
    });

    it('refuses a plugin command that a Commander command already takes', () => {
        const { refused } = mergeProjectManifests(
            core,
            [plugin('acme-cli', ['dev']), plugin('cloud-ish', ['cloud', 'deploy'])],
            [
                { path: ['dev'], owner: 'the built-in command "dev"', leaf: true },
                { path: ['cloud'], owner: 'the command "cloud" of old-cloud', leaf: false },
            ],
        );
        // A Commander group can take new subcommands; a Commander command cannot be replaced.
        expect(refused.map(r => [r.package, r.error.code])).toEqual([['acme-cli', 'plugin.command-clash']]);
    });

    it('lets a plugin add to a built-in command that holds core manifest commands, such as migrate', () => {
        const { commands, refused } = mergeProjectManifests(
            core,
            [plugin('acme-cli', ['migrate', 'acme']), plugin('dev-cli', ['dev', 'acme'])],
            [
                { path: ['migrate'], owner: 'the built-in command "migrate"', leaf: true },
                { path: ['dev'], owner: 'the built-in command "dev"', leaf: true },
            ],
        );
        expect(commands.map(c => c.path.join(' '))).toContain('migrate acme');
        expect(refused.map(r => [r.package, r.error.message])).toEqual([
            ['dev-cli', expect.stringContaining('clashes with the built-in command "dev"')],
        ]);
    });

    it('lets a plugin declare a command and commands under it, in either order', () => {
        for (const paths of [
            [
                ['acme', 'deploy'],
                ['acme', 'deploy', 'plan'],
            ],
            [
                ['acme', 'deploy', 'plan'],
                ['acme', 'deploy'],
            ],
        ]) {
            const { commands, refused } = mergeProjectManifests(core, [plugin('acme-cli', ...paths)]);
            expect(refused).toEqual([]);
            expect(
                commands
                    .map(command => command.path.join(' '))
                    .filter(name => name.startsWith('acme'))
                    .sort(),
            ).toEqual(['acme deploy', 'acme deploy plan']);
        }
    });

    it('refuses a command with positional fields that has commands under it', () => {
        const withPositional = plugin('acme-cli', ['acme', 'logs'], ['acme', 'logs', 'export']);
        withPositional.manifest.commands[0].cli = { positional: ['service'] };
        const { refused } = mergeProjectManifests(core, [withPositional]);
        expect(refused.map(r => [r.error.code, r.error.message])).toEqual([
            [
                'plugin.parent-positional',
                expect.stringContaining(
                    '"acme logs" with positional fields, or flags that take an optional value or a list, and the command "acme logs export"',
                ),
            ],
        ]);
    });

    it.each([
        ['an optional value', { type: ['boolean', 'string'] }],
        ['a list', { type: 'array', items: { type: 'string' } }],
    ])('refuses a command with commands under it that has a flag taking %s', (_kind, schema) => {
        const parent = plugin('acme-cli', ['acme', 'deploy'], ['acme', 'deploy', 'plan']);
        parent.manifest.commands[0].input = { type: 'object', properties: { wait: schema } };
        const { refused } = mergeProjectManifests(core, [parent]);
        expect(refused.map(r => [r.error.code, r.error.message])).toEqual([
            [
                'plugin.parent-positional',
                expect.stringContaining('flags that take an optional value or a list'),
            ],
        ]);
    });

    it('refuses a flag that a command and a command under it declare differently', () => {
        const conflicting = plugin('acme-cli', ['acme', 'deploy'], ['acme', 'deploy', 'plan']);
        conflicting.manifest.commands[0].input = {
            type: 'object',
            properties: { target: { type: 'string', enum: ['a', 'b'] } },
        };
        conflicting.manifest.commands[1].input = {
            type: 'object',
            properties: { target: { type: 'string', enum: ['c', 'd'] } },
        };
        const { refused } = mergeProjectManifests(core, [conflicting]);
        expect(refused.map(r => [r.error.code, r.error.message])).toEqual([
            ['plugin.parent-flag-conflict', expect.stringContaining('declares --target differently')],
        ]);

        const shortFlags = plugin('acme-cli', ['acme', 'deploy'], ['acme', 'deploy', 'plan']);
        shortFlags.manifest.commands[0].input = {
            type: 'object',
            properties: { environment: { type: 'string' } },
        };
        shortFlags.manifest.commands[0].cli = { flags: { environment: { short: '-e' } } };
        shortFlags.manifest.commands[1].input = {
            type: 'object',
            properties: { exclude: { type: 'string' } },
        };
        shortFlags.manifest.commands[1].cli = { flags: { exclude: { short: '-e' } } };
        expect(mergeProjectManifests(core, [shortFlags]).refused.map(r => r.error.code)).toEqual([
            'plugin.parent-flag-conflict',
        ]);
    });

    it("still refuses a plugin that adds a command under another package's command", () => {
        const { refused } = mergeProjectManifests(core, [
            plugin('acme-cli', ['acme', 'deploy']),
            plugin('other-cli', ['acme', 'deploy', 'plan']),
        ]);
        expect(refused.map(r => [r.package, r.error.code])).toEqual([['other-cli', 'plugin.command-clash']]);
    });

    it.each([['doctor x'], ['-x'], ['Acme']])(
        'refuses a path segment such as "%s" before Commander sees it',
        segment => {
            const { commands, refused } = mergeProjectManifests(
                core,
                [plugin('acme-cli', [segment])],
                [],
                () => {
                    throw new Error('registration must not be reached');
                },
            );
            expect(refused.map(r => [r.error.code, r.error.message])).toEqual([
                ['plugin.manifest-invalid', expect.stringContaining('is not a lowercase word')],
            ]);
            expect(commands).toHaveLength(3);
        },
    );

    it('refuses a plugin command named after a reserved command, such as help', () => {
        const { refused } = mergeProjectManifests(core, [plugin('acme-cli', ['help'])]);
        expect(refused.map(r => [r.error.code, r.error.message])).toEqual([
            ['plugin.command-clash', expect.stringContaining('the reserved command "help"')],
        ]);
    });

    it.each([
        ['two fields with one flag name', { fooBar: { type: 'string' }, 'foo-bar': { type: 'string' } }, {}],
        ['a short flag Commander cannot parse', { foo: { type: 'string' } }, { foo: { short: '-ab' } }],
    ])('refuses a plugin with %s, and still registers the next plugin', async (_, properties, flags) => {
        const bad = plugin('bad-cli', ['bad']);
        bad.manifest.commands[0].input = { type: 'object', properties };
        bad.manifest.commands[0].cli = { flags };
        const { commands, refused } = await loadProjectCommands({
            coreManifestFile: '/nonexistent/vendure-commands.json',
            plugins: [bad, plugin('good-cli', ['good'])],
            takenPaths: [],
        });
        expect(refused.map(r => [r.package, r.error.code])).toEqual([['bad-cli', 'plugin.manifest-invalid']]);
        expect(commands.map(c => c.source)).toContain('good-cli');
    });

    it("refuses a malformed manifest, and keeps the CLI's own commands", () => {
        const bad = plugin('acme-cli', ['acme']);
        bad.manifest.commands = [{} as ManifestCommand];
        const { commands, refused } = mergeProjectManifests(core, [bad]);
        expect(refused.map(r => r.error.code)).toEqual(['plugin.manifest-invalid']);
        expect(commands).toHaveLength(3);
    });

    it('refuses a manifest that the merge rules reject, such as a reserved field', () => {
        const bad = plugin('acme-cli', ['acme']);
        bad.manifest.commands[0].input = { type: 'object', properties: { json: { type: 'boolean' } } };
        const { refused } = mergeProjectManifests(core, [bad]);
        expect(refused[0].error.code).toBe('plugin.manifest-invalid');
        expect(refused[0].error.message).toContain('"json", which the host reserves');
    });

    it('imports the declarations of the package that declared a command', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-defs-'));
        try {
            const file = path.join(dir, 'commands.mjs');
            fs.writeFileSync(file, "export const commands = [{ path: ['acme'] }];\n");
            const resolved = { ...plugin('acme-cli', ['acme']), definitionsPath: file };
            const merged = mergeProjectManifests(core, [resolved]);
            expect(await merged.loadDefinitions('acme-cli')).toEqual([{ path: ['acme'] }]);
            await expect(merged.loadDefinitions('refused-cli')).rejects.toThrow('No package "refused-cli"');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
