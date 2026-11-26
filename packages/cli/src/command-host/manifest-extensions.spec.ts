import type {
    CommandManifest,
    ManifestCommand,
    ManifestExtension,
} from '@vendure/common/lib/command/manifest';
import { describe, expect, it } from 'vitest';

import type { ResolvedCommandManifest } from '../shared/resolve-cli-plugins.js';

import { mergeProjectManifests } from './manifest.js';

function manifestCommand(commandPath: string[], properties: Record<string, unknown> = {}): ManifestCommand {
    return {
        path: commandPath,
        description: `The ${commandPath.join(' ')} command`,
        keywords: [],
        behavior: 'readonly',
        requires: {},
        consents: {},
        input: { type: 'object', properties },
        cli: {},
        errors: [],
        examples: [],
        expose: { mcp: true },
        hasPlan: false,
    };
}

function manifest(
    packageName: string,
    commands: ManifestCommand[],
    extensions?: ManifestExtension[],
): CommandManifest {
    return {
        manifestVersion: 1,
        package: packageName,
        version: '1.0.0',
        commands,
        ...(extensions ? { extensions } : {}),
    };
}

function plugin(
    packageName: string,
    commands: ManifestCommand[],
    extensions?: ManifestExtension[],
): ResolvedCommandManifest {
    return {
        packageName,
        manifest: manifest(packageName, commands, extensions),
        definitionsPath: `/plugins/${packageName}/commands.js`,
        scope: 'project',
    };
}

function extension(
    commandPath: string[],
    fields: Record<string, unknown>,
    extra: Partial<ManifestExtension> = {},
): ManifestExtension {
    return {
        path: commandPath,
        input: { type: 'object', properties: fields },
        consents: {},
        errors: [],
        cli: {},
        ...extra,
    };
}

const core = manifest('@vendure/cli', [manifestCommand(['doctor'], { strict: { type: 'boolean' } })]);

describe('mergeProjectManifests with extensions', () => {
    it('adds the fields, consents and errors of an extension to its command, and records the package', () => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin(
                '@acme/cloud',
                [],
                [
                    extension(
                        ['doctor'],
                        { project: { type: 'string' } },
                        {
                            consents: { deployPreview: 'Deploy a preview' },
                            errors: [{ code: 'cloud.not-linked', exit: 1 }],
                            cli: { flags: { project: { short: '-p' } } },
                        },
                    ),
                ],
            ),
        ]);

        expect(refused).toEqual([]);
        const doctor = commands.find(command => command.path.join(' ') === 'doctor');
        expect(Object.keys(doctor?.input.properties as object)).toEqual(['strict', 'project']);
        expect(doctor).toMatchObject({
            source: '@vendure/cli',
            consents: { deployPreview: 'Deploy a preview' },
            errors: [{ code: 'cloud.not-linked', exit: 1 }],
            cli: { flags: { project: { short: '-p' } } },
            extendedBy: [{ package: '@acme/cloud', fields: ['project'] }],
        });
    });

    it('lets a package extend a command of a package enabled after it, and records the order', () => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin('@acme/first', [], [extension(['tools', 'sync'], { region: { type: 'string' } })]),
            plugin('@acme/tools', [manifestCommand(['tools', 'sync'])]),
            plugin('@acme/second', [], [extension(['tools', 'sync'], { dryRun: { type: 'boolean' } })]),
        ]);

        expect(refused).toEqual([]);
        expect(commands.find(command => command.path.join(' ') === 'tools sync')?.extendedBy).toEqual([
            { package: '@acme/first', fields: ['region'] },
            { package: '@acme/second', fields: ['dryRun'] },
        ]);
    });

    it("refuses a package's extensions, and keeps its commands, for a command that is not there", () => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin(
                '@acme/cloud',
                [manifestCommand(['cloud', 'deploy'])],
                [extension(['nope'], { project: { type: 'string' } })],
            ),
        ]);

        expect(refused).toEqual([
            {
                package: '@acme/cloud',
                error: expect.objectContaining({ code: 'plugin.extension-target-missing' }),
            },
        ]);
        expect(commands.map(command => command.path.join(' '))).toContain('cloud deploy');
    });

    it('refuses all the extensions of a package when one clashes, and changes no command', () => {
        const { commands, refused } = mergeProjectManifests(core, [
            plugin('@acme/tools', [manifestCommand(['tools', 'sync'])]),
            plugin(
                '@acme/cloud',
                [],
                [
                    extension(['tools', 'sync'], { project: { type: 'string' } }),
                    extension(['doctor'], { strict: { type: 'string' } }),
                ],
            ),
        ]);

        expect(refused.map(entry => [entry.package, entry.error.code, entry.error.message])).toEqual([
            [
                '@acme/cloud',
                'plugin.extension-clash',
                expect.stringContaining('the input field "strict" of "doctor" exists already'),
            ],
        ]);
        expect(commands.every(command => command.extendedBy === undefined)).toBe(true);
    });

    it('refuses a second extension of a command from the same package', () => {
        const { refused } = mergeProjectManifests(core, [
            plugin(
                '@acme/cloud',
                [],
                [
                    extension(['doctor'], { a: { type: 'string' } }),
                    extension(['doctor'], { b: { type: 'string' } }),
                ],
            ),
        ]);

        expect(refused[0]?.error).toMatchObject({
            code: 'plugin.extension-clash',
            message: expect.stringContaining('declares two extensions of it'),
        });
    });

    it('refuses an extension that gives a command with commands under it a flag that could take their name', () => {
        const { refused } = mergeProjectManifests(core, [
            plugin('@acme/tools', [
                manifestCommand(['tools', 'deploy']),
                manifestCommand(['tools', 'deploy', 'plan']),
            ]),
            plugin(
                '@acme/cloud',
                [],
                [extension(['tools', 'deploy'], { tags: { type: 'array', items: { type: 'string' } } })],
            ),
        ]);

        expect(refused.map(entry => [entry.package, entry.error.code, entry.error.message])).toEqual([
            [
                '@acme/cloud',
                'plugin.extension-clash',
                expect.stringContaining('the flag --tags, which takes a list'),
            ],
        ]);
    });

    it('refuses an extension that declares a flag differently from the command under it', () => {
        const { refused } = mergeProjectManifests(core, [
            plugin('@acme/tools', [
                manifestCommand(['tools', 'deploy']),
                manifestCommand(['tools', 'deploy', 'plan'], { target: { type: 'string', enum: ['a'] } }),
            ]),
            plugin(
                '@acme/cloud',
                [],
                [extension(['tools', 'deploy'], { target: { type: 'string', enum: ['b'] } })],
            ),
        ]);

        expect(refused[0]?.error).toMatchObject({
            code: 'plugin.extension-clash',
            message: expect.stringContaining('--target would be declared differently'),
        });
    });
});
