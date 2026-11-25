import type { CommandManifest, ManifestCommand } from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedCommandManifest } from '../shared/resolve-cli-plugins.js';

import { consentDigest } from './digest.js';
import { loadMergedManifest, mergeProjectManifests } from './manifest.js';

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

    it('refuses a plugin that declares both a command and a group at one path', () => {
        const { refused } = mergeProjectManifests(core, [plugin('acme-cli', ['acme', 'sync'], ['acme'])]);
        expect(refused.map(r => [r.error.code, r.error.message])).toEqual([
            [
                'plugin.command-clash',
                expect.stringContaining('"acme", which clashes with the command "acme sync" of acme-cli'),
            ],
        ]);
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
