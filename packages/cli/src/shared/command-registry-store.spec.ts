import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { builtinCommands } from '../commands/builtins';
import { defineCliPlugin } from './cli-plugin';
import { CommandRegistry } from './command-registry-store';
import { PackageJsonLike, discoverCliPlugins, findInactivePluginProvidingCommand, listDirectDependencyNames, listInactiveCliPluginPackages, resolveCliPlugins } from './resolve-cli-plugins';

describe('defineCliPlugin()', () => {
    it('returns a valid plugin definition', () => {
        const plugin = defineCliPlugin({
            id: '@example/cli-plugin',
            commands: [
                {
                    name: 'hello',
                    description: 'Say hello',
                    action: async () => 0,
                },
            ],
        });
        expect(plugin.id).toBe('@example/cli-plugin');
        expect(plugin.commands).toHaveLength(1);
    });

    it('rejects plugins without an id', () => {
        expect(() =>
            defineCliPlugin({
                id: '',
                commands: [],
            }),
        ).toThrow(/plugin id/);
    });

    it('rejects commands without an action', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/broken',
                commands: [
                    {
                        name: 'broken',
                        description: 'Broken',
                        action: undefined as any,
                    },
                ],
            }),
        ).toThrow(/action function/);
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
        expect(registry.toArray()).toHaveLength(1);
    });

    it('replaces an existing command and notifies on stderr', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const registry = new CommandRegistry();
        registry.registerAll([
            {
                name: 'dev',
                description: 'Built-in',
                action: async () => 0,
            },
        ]);
        registry.applyPlugin(
            defineCliPlugin({
                id: '@vendure/cloud',
                commands: [
                    {
                        name: 'dev',
                        description: 'Cloud dev',
                        action: async () => 0,
                    },
                ],
            }),
        );
        expect(registry.get('dev')?.description).toBe('Cloud dev');
        expect(writeSpy).toHaveBeenCalled();
        expect(String(writeSpy.mock.calls[0]?.[0])).toContain('Replaced command "dev" via @vendure/cloud');
        writeSpy.mockRestore();
    });

    it('adds a new command alongside built-ins', () => {
        const registry = new CommandRegistry();
        registry.registerAll([
            {
                name: 'dev',
                description: 'Built-in',
                action: async () => 0,
            },
        ]);
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/extra',
                commands: [
                    {
                        name: 'cloud',
                        description: 'Cloud utilities',
                        action: async () => 0,
                    },
                ],
            }),
        );
        expect(
            registry
                .toArray()
                .map(c => c.name)
                .sort(),
        ).toEqual(['cloud', 'dev']);
    });

    it('allows wrapping a built-in action without premature exit', async () => {
        const order: string[] = [];
        const builtinAction = async () => {
            order.push('builtin');
            return 0;
        };
        const registry = new CommandRegistry();
        registry.register({
            name: 'dev',
            description: 'Built-in',
            action: builtinAction,
        });
        const builtin = registry.get('dev')!;
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/wrap',
                commands: [
                    {
                        name: 'dev',
                        description: 'Wrapped',
                        action: async (...args) => {
                            order.push('before');
                            const code = await builtin.action(...args);
                            order.push('after');
                            return typeof code === 'number' ? code : 0;
                        },
                    },
                ],
            }),
        );
        const exitCode = await registry.get('dev')!.action();
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

describe('resolveCliPlugins()', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
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
                        vendure: { cliPlugin: './cli-plugin.js', cliCommands: ['from-b'] },
                    },
                    entrySource: `
                        module.exports = {
                            id: '@example/b',
                            commands: [{ name: 'from-b', description: 'B', action: async () => 0 }],
                        };
                    `,
                },
                {
                    name: '@example/a',
                    packageJson: {
                        name: '@example/a',
                        vendure: { cliPlugin: './cli-plugin.js', cliCommands: ['from-a'] },
                    },
                    entrySource: `
                        module.exports = {
                            id: '@example/a',
                            commands: [{ name: 'from-a', description: 'A', action: async () => 0 }],
                        };
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
                resolvePackage: fixture.resolvePackage,
            }),
        ).toEqual({ loaded: [], failures: [] });

        const discovered = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            resolvePackage: fixture.resolvePackage,
        });
        expect(discovered.map(plugin => plugin.packageName)).toEqual(['@example/a', '@example/b']);
        expect(discovered.every(plugin => plugin.status === 'not-enabled')).toBe(true);
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
                        module.exports = {
                            id: '@example/a',
                            commands: [{ name: 'from-a', description: 'A', action: async () => 0 }],
                        };
                    `,
                },
                {
                    name: '@example/b',
                    packageJson: {
                        name: '@example/b',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = {
                            id: '@example/b',
                            commands: [{ name: 'from-b', description: 'B', action: async () => 0 }],
                        };
                    `,
                },
                {
                    name: '@example/c',
                    packageJson: {
                        name: '@example/c',
                        vendure: { cliPlugin: './cli-plugin.js' },
                    },
                    entrySource: `
                        module.exports = {
                            id: '@example/c',
                            commands: [{ name: 'from-c', description: 'C', action: async () => 0 }],
                        };
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
        expect(result.failures[0].reason).toMatch(/could not be resolved/);
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
                        module.exports = {
                            id: '@example/good',
                            commands: [{ name: 'good', description: 'Good', action: async () => 0 }],
                        };
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
            `module.exports = {
                id: '@example/hoisted-plugin',
                commands: [{ name: 'hoisted', description: 'Hoisted', action: async () => 0 }],
            };\n`,
        );

        const result = resolveCliPlugins({ cwd: projectRoot });

        expect(result.failures).toEqual([]);
        expect(result.loaded.map(plugin => plugin.packageName)).toEqual(['@example/hoisted-plugin']);
    });

    it('reports a failure when a plugin exports an invalid command', () => {
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
                    entrySource: `module.exports = {
                        id: '@example/broken',
                        commands: [{ name: 'broken', description: 'Broken' }],
                    };`,
                },
            ],
        });

        const result = resolveCliPlugins({
            cwd: fixture.root,
            projectPackageJson: fs.readJsonSync(path.join(fixture.root, 'package.json')) as PackageJsonLike,
            resolvePackage: fixture.resolvePackage,
        });

        expect(result.loaded).toEqual([]);
        expect(result.failures[0].reason).toMatch(/must provide an action function/);
    });

    it('reports an enabled but invalid plugin as failed when discovery validates', () => {
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
                    entrySource: `module.exports = {
                        id: '@example/broken',
                        commands: [{ name: 'broken', description: 'Broken' }],
                    };`,
                },
            ],
        });
        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;

        const withoutValidation = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            resolvePackage: fixture.resolvePackage,
        });
        expect(withoutValidation[0].status).toBe('enabled');

        const withValidation = discoverCliPlugins({
            cwd: fixture.root,
            projectPackageJson,
            resolvePackage: fixture.resolvePackage,
            validate: true,
        });
        expect(withValidation[0].status).toBe('failed');
        expect(withValidation[0].reason).toMatch(/must provide an action function/);
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
                            cliCommands: ['cloud-deploy'],
                        },
                    },
                    entrySource: `
                        module.exports = {
                            id: '@vendure/cloud',
                            commands: [{ name: 'cloud-deploy', description: 'Deploy', action: async () => 0 }],
                        };
                    `,
                },
            ],
        });

        const projectPackageJson = fs.readJsonSync(
            path.join(fixture.root, 'package.json'),
        ) as PackageJsonLike;
        const match = findInactivePluginProvidingCommand('cloud-deploy', {
            cwd: fixture.root,
            projectPackageJson,
            resolvePackage: fixture.resolvePackage,
        });
        expect(match?.packageName).toBe('@vendure/cloud');
        expect(listInactiveCliPluginPackages({
            cwd: fixture.root,
            projectPackageJson,
            resolvePackage: fixture.resolvePackage,
        })).toEqual(['@vendure/cloud']);
    });
});
