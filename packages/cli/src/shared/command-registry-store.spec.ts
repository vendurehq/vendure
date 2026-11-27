import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { builtinCommands } from '../commands/builtins.js';

import { commandManifest } from './__tests__/command-manifest.js';
import {
    CliCommandDefinition,
    CliCommandGroupDefinition,
    hasCliSubcommands,
    isCliCommandGroup,
    isRunnableCliCommand,
} from './cli-command-definition.js';
import { CLI_PLUGIN_EXTENSION_POINTS, assertCommandTree, defineCliPlugin } from './cli-plugin.js';
import { CliPluginRegistrationError, CommandRegistry } from './command-registry-store.js';
import {
    PackageJsonLike,
    cliPluginCommandNames,
    discoverCliPlugins,
    findInactivePluginProvidingCommand,
    listDirectDependencyNames,
    listInactiveCliPluginPackages,
    resolveCliPlugins,
} from './resolve-cli-plugins.js';

describe('defineCliPlugin()', () => {
    it('returns a valid plugin definition', () => {
        const plugin = defineCliPlugin({
            id: '@example/cli-plugin',
            rootOptions: [{ long: '--token <token>', description: 'API token', required: true }],
        });
        expect(plugin.id).toBe('@example/cli-plugin');
        expect(plugin.rootOptions).toHaveLength(1);
    });

    it('rejects plugins without an id', () => {
        expect(() =>
            defineCliPlugin({
                id: '',
            }),
        ).toThrow(/plugin id/);
    });

    it('rejects a plugin that declares commands, naming the command manifest', () => {
        const plugin = {
            id: '@example/legacy',
            commands: [{ name: 'hello', description: 'Say hello', action: async () => 0 }],
        };

        expect(() => defineCliPlugin(plugin as any)).toThrow(/\[plugin\.commands-removed\]/);
        expect(() => defineCliPlugin(plugin as any)).toThrow(
            expect.objectContaining({ code: 'plugin.commands-removed' }),
        );
        expect(() => defineCliPlugin(plugin as any)).toThrow(/vendure\.commandManifest/);
        expect(() => defineCliPlugin(plugin as any)).toThrow(/@example\/legacy/);
    });

    it('accepts an empty commands array', () => {
        const plugin = defineCliPlugin({ id: '@example/extender', commands: [] } as any);

        expect(plugin.id).toBe('@example/extender');
    });

    it('rejects a shared option declared twice', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/dupes',
                rootOptions: [
                    { long: '--token <token>', description: 'API token', required: true },
                    { long: '--token <token>', description: 'API token again', required: true },
                ],
            }),
        ).toThrow(/declares "--token" twice/);
    });

    it('no longer lists the extension points of plugin commands', () => {
        expect(CLI_PLUGIN_EXTENSION_POINTS).toEqual([
            'rootOptions',
            'extendCommands',
            'afterConsoleLink',
            'commandManifest',
        ]);
        expect(CLI_PLUGIN_EXTENSION_POINTS).not.toContain('commands');
        expect(CLI_PLUGIN_EXTENSION_POINTS).not.toContain('subcommands');
        expect(CLI_PLUGIN_EXTENSION_POINTS).not.toContain('requiresProject');
    });
});

describe('CommandRegistry', () => {
    it('registers built-in commands and allows lookup', () => {
        const registry = new CommandRegistry();
        registry.registerAll([
            {
                name: 'dev',
                description: 'Built-in dev',
                action: async () => 0,
            },
        ]);
        expect(registry.get('dev')?.description).toBe('Built-in dev');
        expect(registry.getCommandTree()).toHaveLength(1);
    });

    it('allows wrapping a built-in action without premature exit', async () => {
        const order: string[] = [];
        const registry = new CommandRegistry();
        registry.register({
            name: 'dev',
            description: 'Built-in',
            action: async () => {
                order.push('builtin');
                return 0;
            },
        });
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/wrap',
                extendCommands: [
                    {
                        command: 'dev',
                        decorate:
                            ({ next }) =>
                            async (...args) => {
                                order.push('before');
                                const code = await next(...args);
                                order.push('after');
                                return typeof code === 'number' ? code : 0;
                            },
                    },
                ],
            }),
        );
        const exitCode = await (registry.get('dev') as CliCommandDefinition).action();
        expect(exitCode).toBe(0);
        expect(order).toEqual(['before', 'builtin', 'after']);
    });

    it('returns an actual built-in failure code without terminating the process', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('process.exit was called');
        }) as never);

        const exitCode = await builtinCommands.codemod.action('unknown-transform', undefined, {});

        expect(exitCode).toBe(1);
        expect(exitSpy).not.toHaveBeenCalled();
        exitSpy.mockRestore();
    });
});

describe('CommandRegistry nested commands and shared options', () => {
    function registryWithBuiltins(): CommandRegistry {
        const registry = new CommandRegistry();
        registry.registerAll([
            { name: 'dev', description: 'Built-in dev', action: async () => 0 },
            {
                name: 'plugins',
                description: 'Manage CLI plugins',
                options: [{ long: '--json', description: 'Output JSON' }],
                action: async () => 0,
            },
        ]);
        return registry;
    }

    const cloudPlugin = () =>
        defineCliPlugin({
            id: '@vendure/cloud',
            rootOptions: [
                { long: '--token <token>', description: 'API token', required: true },
                { long: '--json', description: 'Output JSON' },
            ],
        });

    it('registers a nested command tree and its shared options', () => {
        const registry = registryWithBuiltins();
        registry.register({
            name: 'project',
            description: 'Manage projects',
            subcommands: [{ name: 'list', description: 'List projects', action: async () => 0 }],
        });
        registry.applyPlugin(cloudPlugin());

        const project = registry.get('project');
        expect(project && isCliCommandGroup(project)).toBe(true);
        expect((project as CliCommandGroupDefinition).subcommands.map(c => c.name)).toEqual(['list']);
        expect(registry.getRootOptions().map(entry => entry.option.long)).toEqual([
            '--token <token>',
            '--json',
        ]);
    });

    it('accepts a shared option that an existing command also declares', () => {
        // The built-in `plugins --json` and a shared `--json` both take no
        // value, so they can refer to the same value.
        const registry = registryWithBuiltins();
        registry.applyPlugin(cloudPlugin());

        expect(registry.getRootOptions().map(entry => entry.option.long)).toEqual([
            '--token <token>',
            '--json',
        ]);
    });

    it('rejects a shared option already registered by another plugin', () => {
        const registry = registryWithBuiltins();
        registry.applyPlugin(cloudPlugin());

        const other = defineCliPlugin({
            id: '@example/other',
            rootOptions: [{ long: '--token <token>', description: 'Another token', required: true }],
        });

        expect(() => registry.applyPlugin(other)).toThrow(/already registered by @vendure\/cloud/);
    });

    it('rejects a shared option that resolves to the same name as another', () => {
        // `--api-token` and `--apiToken` are written differently, but Commander
        // stores both under `apiToken`.
        const registry = registryWithBuiltins();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/first',
                rootOptions: [{ long: '--api-token <token>', description: 'API token', required: true }],
            }),
        );

        const second = defineCliPlugin({
            id: '@example/second',
            rootOptions: [{ long: '--apiToken <token>', description: 'API token', required: true }],
        });

        expect(() => registry.applyPlugin(second)).toThrow(/already registered by @example\/first/);
        expect(registry.getRootOptions()).toHaveLength(1);
    });

    it('rejects a shared option that takes a flag reserved by the CLI', () => {
        const registry = registryWithBuiltins();
        const plugin = defineCliPlugin({
            id: '@example/greedy',
            rootOptions: [{ long: '--help', description: 'Custom help' }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
    });

    it('rejects a shared option whose value shape disagrees with an existing command option', () => {
        const registry = registryWithBuiltins();
        const plugin = defineCliPlugin({
            id: '@example/clash',
            rootOptions: [{ long: '--json <file>', description: 'Write JSON to a file', required: true }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/one takes a value and the other does not/);
    });

    it('keeps the built-in commands available when a plugin is rejected', () => {
        const registry = registryWithBuiltins();
        const plugin = defineCliPlugin({
            id: '@example/broken',
            rootOptions: [{ long: '--help', description: 'Custom help' }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(CliPluginRegistrationError);
        expect(registry.has('plugins')).toBe(true);
        expect(registry.get('dev')?.description).toBe('Built-in dev');
        expect(registry.getRootOptions()).toEqual([]);
    });

    it('reports every conflict at once', () => {
        const registry = registryWithBuiltins();
        const plugin = defineCliPlugin({
            id: '@example/messy',
            rootOptions: [
                { long: '--version', description: 'Custom version' },
                { long: '--help', description: 'Custom help' },
            ],
        });

        try {
            registry.applyPlugin(plugin);
            expect.unreachable('applyPlugin should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(CliPluginRegistrationError);
            expect((e as CliPluginRegistrationError).conflicts).toEqual([
                'Shared option "--version" uses "--version", which is reserved by the CLI.',
                'Shared option "--help" uses "--help", which is reserved by the CLI.',
            ]);
        }
    });
});

describe('assertCommandTree() with nested commands', () => {
    it('accepts a nested tree with shared options', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'config',
                    description: 'Manage configuration',
                    options: [{ long: '--profile <name>', description: 'Profile', required: true }],
                    subcommands: [
                        {
                            name: 'server',
                            description: 'Server configuration',
                            subcommands: [
                                {
                                    name: 'set',
                                    description: 'Set a value',
                                    arguments: [
                                        { name: 'key', description: 'Key', required: true },
                                        { name: 'value', description: 'Value', required: true },
                                    ],
                                    action: async () => 0,
                                },
                            ],
                        },
                    ],
                },
            ]),
        ).not.toThrow();
    });

    it('rejects a command group without subcommands', () => {
        expect(() =>
            assertCommandTree('builtins', [
                { name: 'project', description: 'Manage projects', subcommands: [] },
            ]),
        ).toThrow(/^The command tree "builtins" command "project" declares "subcommands" but provides none/);
    });

    it('accepts a command that has both an action and subcommands', () => {
        const deploy: CliCommandDefinition = {
            name: 'deploy',
            description: 'Deploy the application',
            options: [{ long: '--env <name>', description: 'Target environment', required: true }],
            action: async () => 0,
            subcommands: [
                {
                    name: 'plan',
                    description: 'Show what a deploy would change',
                    action: async () => 0,
                },
                { name: 'teardown', description: 'Tear the deployment down', action: async () => 0 },
            ],
        };

        expect(() => assertCommandTree('builtins', [deploy])).not.toThrow();
        expect(isRunnableCliCommand(deploy) && hasCliSubcommands(deploy)).toBe(true);
    });

    it('accepts a runnable command with subcommands nested inside a group', () => {
        const backup: CliCommandGroupDefinition = {
            name: 'backup',
            description: 'Manage backups',
            subcommands: [
                {
                    name: 'db',
                    description: 'Back the database up',
                    action: async () => 0,
                    subcommands: [
                        { name: 'list', description: 'List database backups', action: async () => 0 },
                        {
                            name: 'status',
                            description: 'Show the status of a backup',
                            action: async () => 0,
                        },
                    ],
                },
            ],
        };

        expect(() => assertCommandTree('builtins', [backup])).not.toThrow();
        const db = backup.subcommands[0];
        expect(isCliCommandGroup(backup)).toBe(true);
        expect(isRunnableCliCommand(db) && hasCliSubcommands(db)).toBe(true);
    });

    it('rejects positional arguments on a command that has subcommands', () => {
        // The first word after the command would be ambiguous: it could name a
        // subcommand or fill the argument.
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'deploy',
                    description: 'Deploy the application',
                    arguments: [{ name: 'target', description: 'What to deploy' }],
                    action: async () => 0,
                    subcommands: [
                        { name: 'plan', description: 'Show what would change', action: async () => 0 },
                    ],
                },
            ]),
        ).toThrow(/declares both positional arguments and subcommands/);
    });

    it('rejects positional arguments on a command group', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'backup',
                    description: 'Manage backups',
                    arguments: [{ name: 'target', description: 'What to back up' }],
                    subcommands: [{ name: 'db', description: 'Back the database up', action: async () => 0 }],
                } as any,
            ]),
        ).toThrow(/declares both positional arguments and subcommands/);
    });

    it('accepts an empty arguments array alongside subcommands', () => {
        // Only a declared positional is ambiguous; an empty array declares none.
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'deploy',
                    description: 'Deploy the application',
                    arguments: [],
                    action: async () => 0,
                    subcommands: [
                        { name: 'plan', description: 'Show what would change', action: async () => 0 },
                    ],
                },
            ]),
        ).not.toThrow();
    });

    it('rejects a runnable parent that declares subcommands but provides none', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'deploy',
                    description: 'Deploy the application',
                    action: async () => 0,
                    subcommands: [],
                },
            ]),
        ).toThrow(/at least one subcommand/);
    });

    it('rejects an action that is not a function alongside subcommands', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'deploy',
                    description: 'Deploy the application',
                    action: 'run it' as any,
                    subcommands: [
                        { name: 'plan', description: 'Show what would change', action: async () => 0 },
                    ],
                },
            ]),
        ).toThrow(/declares an action that is not a function/);
    });

    it('rejects commands without an action', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'broken',
                    description: 'Broken',
                    action: undefined as any,
                },
            ]),
        ).toThrow(/action function/);
    });

    it('rejects a nested command without an action', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'project',
                    description: 'Manage projects',
                    subcommands: [{ name: 'list', description: 'List projects', action: undefined as any }],
                },
            ]),
        ).toThrow(/command "project list" must provide an action function/);
    });

    it('rejects duplicate sibling command names', () => {
        expect(() =>
            assertCommandTree('builtins', [
                {
                    name: 'project',
                    description: 'Manage projects',
                    subcommands: [
                        { name: 'list', description: 'List projects', action: async () => 0 },
                        { name: 'list', description: 'List projects again', action: async () => 0 },
                    ],
                },
            ]),
        ).toThrow(/declares the command "project list" more than once/);
    });
});

describe('resolveCliPlugins()', () => {
    const tempDirs: string[] = [];

    beforeEach(() => {
        // Keep the real global CLI config out of these tests.
        const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-config-'));
        tempDirs.push(configDir);
        vi.stubEnv('VENDURE_CLI_CONFIG_DIR', configDir);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        for (const dir of tempDirs.splice(0)) {
            fs.removeSync(dir);
        }
    });

    function makeTempProject(options: {
        project: PackageJsonLike;
        plugins: Array<{
            name: string;
            packageJson: PackageJsonLike;
            entrySource: string;
            entryFile?: string;
            manifestCommands?: string[][];
            files?: Record<string, string>;
        }>;
    }) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-plugins-'));
        tempDirs.push(root);
        fs.writeJsonSync(path.join(root, 'package.json'), options.project, { spaces: 2 });

        const packageMap = new Map<string, { dir: string; packageJson: PackageJsonLike }>();

        for (const plugin of options.plugins) {
            const dir = path.join(root, 'node_modules', ...plugin.name.split('/'));
            fs.ensureDirSync(dir);
            fs.writeJsonSync(path.join(dir, 'package.json'), plugin.packageJson, { spaces: 2 });
            const entryFile = plugin.entryFile ?? 'cli-plugin.js';
            fs.writeFileSync(path.join(dir, entryFile), plugin.entrySource);
            for (const [file, source] of Object.entries(plugin.files ?? {})) {
                fs.writeFileSync(path.join(dir, file), source);
            }
            if (plugin.manifestCommands) {
                fs.writeJsonSync(
                    path.join(dir, 'vendure-commands.json'),
                    commandManifest(plugin.name, plugin.manifestCommands),
                );
            }
            packageMap.set(plugin.name, { dir, packageJson: plugin.packageJson });
        }

        return {
            root,
            resolvePackage: (packageName: string) => packageMap.get(packageName) ?? null,
        };
    }

    it('does not load plugins until they are listed in vendure.cli.plugins', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: {
                    '@example/a': '1.0.0',
                    '@example/b': '1.0.0',
                    'plain-dep': '1.0.0',
                },
            },
            plugins: [
                {
                    name: '@example/b',
                    packageJson: {
                        name: '@example/b',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = { id: '@example/b' };
                    `,
                },
                {
                    name: '@example/a',
                    packageJson: {
                        name: '@example/a',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = { id: '@example/a' };
                    `,
                },
                {
                    name: 'plain-dep',
                    packageJson: { name: 'plain-dep' },
                    entrySource: 'module.exports = {};',
                },
            ],
        });

        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;

        expect(
            resolveCliPlugins({
                cwd: fixture.root,
                projectPackageJson,
                scopes: ['project'],
                resolvePackage: fixture.resolvePackage,
            }),
        ).toEqual({
            loaded: [],
            manifests: [],
            failures: [],
            scopeErrors: [],
            // Only the allowlist: no package is enabled.
            watchedFiles: [path.join(path.resolve(fixture.root), 'package.json')],
            projectRoot: path.resolve(fixture.root),
        });

        const discovered = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
        });
        expect(discovered.map(plugin => plugin.packageName)).toEqual(['@example/a', '@example/b']);
        expect(discovered.every(plugin => plugin.status === 'not-enabled')).toBe(true);
    });

    // A plugin applied twice contributes its afterConsoleLink hook twice, and a
    // plugin with no extensions has nothing to collide with on the second pass.
    it('loads a plugin listed twice only once', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/a': '1.0.0' },
                vendure: { cli: { plugins: ['@example/a', '@example/a'] } },
            },
            plugins: [
                {
                    name: '@example/a',
                    packageJson: {
                        name: '@example/a',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = {
                            id: '@example/a',
                            afterConsoleLink: async () => undefined,
                        };
                    `,
                },
            ],
        });

        const { loaded, failures } = resolveCliPlugins({
            cwd: fixture.root,
            projectPackageJson: fs.readJsonSync(path.join(fixture.root, 'package.json')) as PackageJsonLike,
            resolvePackage: fixture.resolvePackage,
        });

        expect(failures).toEqual([]);
        expect(loaded.map(plugin => plugin.packageName)).toEqual(['@example/a']);

        const registry = new CommandRegistry();
        for (const entry of loaded) {
            registry.applyPlugin(entry.plugin);
        }
        expect(registry.getPluginExtensions('afterConsoleLink')).toHaveLength(1);
    });

    // The allowlist is not the only way an id reaches the registry twice, and
    // `id` is author-chosen, so two packages can collide on it.
    it('refuses a second plugin under an id that is already registered', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/a',
                afterConsoleLink: async () => undefined,
            }),
        );

        expect(() =>
            registry.applyPlugin(
                defineCliPlugin({
                    id: '@example/a',
                    afterConsoleLink: async () => undefined,
                }),
            ),
        ).toThrow(/already registered under the id/);
        // Rejected whole, like every other collision: no second hook.
        expect(registry.getPluginExtensions('afterConsoleLink')).toHaveLength(1);
    });

    // The id rule is about the id, not about hooks. It held in one combination
    // of four when it only fired alongside a hook.
    it('refuses a duplicate id even when neither plugin registers a hook', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/a',
            }),
        );

        expect(() =>
            registry.applyPlugin(
                defineCliPlugin({
                    id: '@example/a',
                }),
            ),
        ).toThrow(/already registered under the id/);
    });

    it('loads allowlisted plugins in declared order', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: {
                    '@example/a': '1.0.0',
                    '@example/b': '1.0.0',
                    '@example/c': '1.0.0',
                },
                vendure: {
                    cli: {
                        plugins: ['@example/c', '@example/a'],
                    },
                },
            },
            plugins: [
                {
                    name: '@example/a',
                    packageJson: {
                        name: '@example/a',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = { id: '@example/a' };
                    `,
                },
                {
                    name: '@example/b',
                    packageJson: {
                        name: '@example/b',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = { id: '@example/b' };
                    `,
                },
                {
                    name: '@example/c',
                    packageJson: {
                        name: '@example/c',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = { id: '@example/c' };
                    `,
                },
            ],
        });

        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;
        const result = resolveCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
        });

        expect(result.failures).toEqual([]);
        expect(result.loaded.map(p => p.packageName)).toEqual(['@example/c', '@example/a']);
    });

    it('reports a failure instead of throwing when an enabled plugin cannot be resolved', () => {
        const result = resolveCliPlugins({
            cwd: '/tmp',
            projectPackageJson: {
                name: 'demo',
                dependencies: { '@missing/plugin': '1.0.0' },
                vendure: { cli: { plugins: ['@missing/plugin'] } },
            },
            resolvePackage: () => null,
        });

        expect(result.loaded).toEqual([]);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].packageName).toBe('@missing/plugin');
        expect(result.failures[0].reason).toMatch(/is a dependency of \/tmp but is not installed/);
    });

    it('reports a failure when an enabled plugin is not a direct dependency', () => {
        const result = resolveCliPlugins({
            cwd: '/tmp',
            projectPackageJson: {
                name: 'demo',
                vendure: { cli: { plugins: ['@transitive/plugin'] } },
            },
            resolvePackage: () => ({
                dir: '/tmp/transitive-plugin',
                packageJson: {
                    name: '@transitive/plugin',
                    vendure: { cliPlugin: './cli-plugin.js' },
                },
            }),
        });

        expect(result.loaded).toEqual([]);
        expect(result.failures[0].reason).toMatch(/not a direct dependency/);
    });

    it('keeps loading other plugins when one fails', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: {
                    '@example/good': '1.0.0',
                    '@example/broken': '1.0.0',
                },
                vendure: {
                    cli: { plugins: ['@example/broken', '@example/good'] },
                },
            },
            plugins: [
                {
                    name: '@example/good',
                    packageJson: {
                        name: '@example/good',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = { id: '@example/good' };
                    `,
                },
                {
                    name: '@example/broken',
                    packageJson: {
                        name: '@example/broken',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `throw new Error('boom at require time');`,
                },
            ],
        });

        const result = resolveCliPlugins({
            cwd: fixture.root,
            projectPackageJson: fs.readJsonSync(path.join(fixture.root, 'package.json')) as PackageJsonLike,
            resolvePackage: fixture.resolvePackage,
        });

        expect(result.loaded.map(p => p.packageName)).toEqual(['@example/good']);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].packageName).toBe('@example/broken');
        expect(result.failures[0].reason).toMatch(/boom at require time/);
    });

    it('resolves a hoisted plugin whose package.json is not exported when enabled', () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-cli-workspace-'));
        tempDirs.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, 'packages', 'app');
        const pluginRoot = path.join(workspaceRoot, 'node_modules', '@example', 'hoisted-plugin');
        fs.ensureDirSync(projectRoot);
        fs.ensureDirSync(pluginRoot);
        fs.writeJsonSync(path.join(projectRoot, 'package.json'), {
            name: 'app',
            dependencies: { '@example/hoisted-plugin': '1.0.0' },
            vendure: { cli: { plugins: ['@example/hoisted-plugin'] } },
        });
        fs.writeJsonSync(path.join(pluginRoot, 'package.json'), {
            name: '@example/hoisted-plugin',
            exports: { '.': './index.js' },
            vendure: { cliPlugin: './cli-plugin.js' },
        });
        fs.writeFileSync(path.join(pluginRoot, 'index.js'), 'module.exports = {};\n');
        fs.writeFileSync(
            path.join(pluginRoot, 'cli-plugin.js'),
            `module.exports = { id: '@example/hoisted-plugin' };\n`,
        );

        const result = resolveCliPlugins({ cwd: projectRoot });

        expect(result.failures).toEqual([]);
        expect(result.loaded.map(plugin => plugin.packageName)).toEqual(['@example/hoisted-plugin']);
    });

    it('reports a failure when a plugin still declares commands', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/broken': '1.0.0' },
                vendure: { cli: { plugins: ['@example/broken'] } },
            },
            plugins: [
                {
                    name: '@example/broken',
                    packageJson: {
                        name: '@example/broken',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `module.exports = { id: '@example/broken', commands: [{ name: 'broken', description: 'Broken', action: async () => 0 }] };`,
                },
            ],
        });

        const result = resolveCliPlugins({
            cwd: fixture.root,
            projectPackageJson: fs.readJsonSync(path.join(fixture.root, 'package.json')) as PackageJsonLike,
            resolvePackage: fixture.resolvePackage,
        });

        expect(result.loaded).toEqual([]);
        expect(result.failures[0].reason).toMatch(/\[plugin\.commands-removed\]/);
    });

    it('loads the manifest commands of a package whose CLI plugin still declares commands', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/half-ported': '1.0.0' },
                vendure: { cli: { plugins: ['@example/half-ported'] } },
            },
            plugins: [
                {
                    name: '@example/half-ported',
                    packageJson: {
                        name: '@example/half-ported',
                        vendure: {
                            cliPlugin: './cli-plugin.js',
                            commandManifest: './vendure-commands.json',
                            commandDefinitions: './commands.js',
                        },
                    },
                    files: { 'commands.js': 'export const commands = [];' },
                    entrySource: `module.exports = { id: '@example/half-ported', commands: [{ name: 'old', description: 'Old', action: async () => 0 }] };`,
                    manifestCommands: [['half', 'deploy']],
                },
            ],
        });

        const result = resolveCliPlugins({
            cwd: fixture.root,
            projectPackageJson: fs.readJsonSync(path.join(fixture.root, 'package.json')) as PackageJsonLike,
            resolvePackage: fixture.resolvePackage,
        });

        expect(result.manifests.map(manifest => manifest.packageName)).toEqual(['@example/half-ported']);
        expect(result.loaded).toEqual([]);
        expect(result.failures).toEqual([
            expect.objectContaining({
                packageName: '@example/half-ported',
                failedPart: 'cliPlugin',
                reason: expect.stringContaining('[plugin.commands-removed]'),
            }),
        ]);
    });

    it('reports an enabled plugin that still declares commands as failed when discovery validates', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/broken': '1.0.0' },
                vendure: { cli: { plugins: ['@example/broken'] } },
            },
            plugins: [
                {
                    name: '@example/broken',
                    packageJson: {
                        name: '@example/broken',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `module.exports = { id: '@example/broken', commands: [{ name: 'broken', description: 'Broken', action: async () => 0 }] };`,
                },
            ],
        });
        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;

        const withoutValidation = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
        });
        expect(withoutValidation[0].status).toBe('enabled');

        const withValidation = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
            validate: true,
        });
        expect(withValidation[0].status).toBe('failed');
        expect(withValidation[0].reason).toMatch(/\[plugin\.commands-removed\]/);
    });

    // An enabled plugin is loaded anyway, but the names a package contributes
    // are the ones its command manifest declares.
    it('reads the commands of an enabled package from its command manifest', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/a': '1.0.0' },
                vendure: { cli: { plugins: ['@example/a'] } },
            },
            plugins: [
                {
                    name: '@example/a',
                    packageJson: {
                        name: '@example/a',
                        vendure: { cliPlugin: './cli-plugin.js', commandManifest: './vendure-commands.json' },
                    },
                    entrySource: `module.exports = { id: '@example/a' };`,
                    manifestCommands: [['deploy'], ['status', 'show'], ['status', 'list']],
                },
            ],
        });
        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;

        const [plugin] = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
            validate: true,
        });

        expect(plugin.manifestCommands).toEqual(['deploy', 'status']);
        expect(cliPluginCommandNames(plugin)).toEqual(['deploy', 'status']);
    });

    // An installed but not-enabled package is never executed, so its manifest
    // is the only thing there is to go on.
    it('reads the commands of a package that is not enabled from its command manifest', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/a': '1.0.0' },
            },
            plugins: [
                {
                    name: '@example/a',
                    packageJson: {
                        name: '@example/a',
                        vendure: { cliPlugin: './cli-plugin.js', commandManifest: './vendure-commands.json' },
                    },
                    entrySource: `throw new Error('must not be loaded');`,
                    manifestCommands: [['deploy']],
                },
            ],
        });
        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;

        const [plugin] = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
            validate: true,
        });

        expect(plugin.status).toBe('not-enabled');
        expect(cliPluginCommandNames(plugin)).toEqual(['deploy']);
    });

    it('reports no commands for a package that declares none and is not loaded', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@example/a': '1.0.0' },
            },
            plugins: [
                {
                    name: '@example/a',
                    packageJson: { name: '@example/a', vendure: { cliPlugin: './cli-plugin.js' } },
                    entrySource: `module.exports = { id: '@example/a' };`,
                },
            ],
        });

        const [plugin] = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson: fs.readJsonSync(path.join(fixture.root, 'package.json')) as PackageJsonLike,
            resolvePackage: fixture.resolvePackage,
        });

        expect(cliPluginCommandNames(plugin)).toEqual([]);
    });

    it('lists direct dependency names from all dependency sections', () => {
        expect(
            listDirectDependencyNames({
                dependencies: { a: '1' },
                devDependencies: { b: '1' },
                optionalDependencies: { c: '1' },
            }).sort(),
        ).toEqual(['a', 'b', 'c']);
    });

    it('finds an inactive plugin that declares a command name', () => {
        const fixture = makeTempProject({
            project: {
                name: 'demo',
                dependencies: { '@vendure/cloud': '1.0.0' },
            },
            plugins: [
                {
                    name: '@vendure/cloud',
                    packageJson: {
                        name: '@vendure/cloud',
                        vendure: {
                            cliPlugin: './cli-plugin.js',
                            commandManifest: './vendure-commands.json',
                        },
                    },
                    entrySource: `
                        module.exports = { id: '@vendure/cloud' };
                    `,
                    manifestCommands: [['cloud-deploy']],
                },
            ],
        });

        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;
        const match = findInactivePluginProvidingCommand('cloud-deploy', {
            cwd: fixture.root,
            projectPackageJson,
            scopes: ['project'],
            resolvePackage: fixture.resolvePackage,
        });
        expect(match?.packageName).toBe('@vendure/cloud');
        expect(
            listInactiveCliPluginPackages({
                cwd: fixture.root,
                projectPackageJson,
                scopes: ['project'],
                resolvePackage: fixture.resolvePackage,
            }),
        ).toEqual(['@vendure/cloud']);
    });
});
