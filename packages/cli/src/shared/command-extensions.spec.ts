import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from './__tests__/run-cli';
import { CliCommandDefinition, CliCommandGroupDefinition } from './cli-command-definition';
import { defineCliPlugin } from './cli-plugin';
import { CliPluginRegistrationError, CommandRegistry } from './command-registry-store';

/**
 * Records the order in which the built-in and each plugin wrapper runs, so a
 * test can assert that every wrapper ran exactly once and in which order.
 */
const trace: string[] = [];

const PLATFORM_ID = '@vendure-platform/cli';
const CLOUD_ID = '@vendure/cloud';

/**
 * Stands in for the built-in `dev` command.
 */
function coreDev(): CliCommandDefinition {
    return {
        name: 'dev',
        description: 'Run Vendure in development mode',
        arguments: [{ name: 'target', description: 'Target to run', required: false }],
        options: [{ long: '--no-reload', description: 'Disable automatic restarts' }],
        action: async (target: string | undefined) => {
            trace.push(`core:${target ?? 'all'}`);
            return 0;
        },
    };
}

function registryWithCore(): CommandRegistry {
    const registry = new CommandRegistry();
    registry.registerAll([
        coreDev(),
        { name: 'plugins', description: 'Manage CLI plugins', action: async () => 0 },
        {
            name: 'config',
            description: 'Manage configuration',
            subcommands: [{ name: 'server', description: 'Server configuration', action: async () => 0 }],
        },
    ]);
    return registry;
}

/**
 * Mirrors what `@vendure-platform/cli` does today: add an option to `dev` and
 * wrap its action, calling the action it was handed rather than importing the
 * built-in one.
 */
function platformPlugin() {
    return defineCliPlugin({
        id: PLATFORM_ID,
        commands: [],
        extendCommands: [
            {
                command: 'dev',
                description: 'Run Vendure in development mode with linked Platform credentials',
                options: [{ long: '--rotate-credential', description: 'Replace the active credential' }],
                decorate:
                    ({ next }) =>
                    async (...args: any[]) => {
                        trace.push('platform:before');
                        const code = await next(...args);
                        trace.push('platform:after');
                        return code;
                    },
            },
        ],
    });
}

function cloudPlugin() {
    return defineCliPlugin({
        id: CLOUD_ID,
        commands: [],
        extendCommands: [
            {
                command: 'dev',
                options: [{ long: '--cloud-env <name>', description: 'Cloud environment', required: true }],
                decorate:
                    ({ next }) =>
                    async (...args: any[]) => {
                        trace.push('cloud:before');
                        const code = await next(...args);
                        trace.push('cloud:after');
                        return code;
                    },
            },
        ],
    });
}

function devCommand(registry: CommandRegistry): CliCommandDefinition {
    return registry.get('dev') as CliCommandDefinition;
}

describe('Command extensions: composition', () => {
    afterEach(() => {
        trace.length = 0;
    });

    it('runs every wrapper exactly once, outermost first', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());
        registry.applyPlugin(cloudPlugin());

        await devCommand(registry).action('server');

        expect(trace).toEqual([
            'cloud:before',
            'platform:before',
            'core:server',
            'platform:after',
            'cloud:after',
        ]);
    });

    it('follows vendure.cli.plugins order, so the last listed plugin is outermost', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(cloudPlugin());
        registry.applyPlugin(platformPlugin());

        await devCommand(registry).action('server');

        expect(trace).toEqual([
            'platform:before',
            'cloud:before',
            'core:server',
            'cloud:after',
            'platform:after',
        ]);
    });

    it('records which plugins extended the command, in application order', () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());
        registry.applyPlugin(cloudPlugin());

        expect(registry.getExtendedBy('dev')).toEqual([PLATFORM_ID, CLOUD_ID]);
    });

    it('keeps the options contributed by every plugin', () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());
        registry.applyPlugin(cloudPlugin());

        expect(devCommand(registry).options?.map(option => option.long)).toEqual([
            '--no-reload',
            '--rotate-credential',
            '--cloud-env <name>',
        ]);
    });

    it('hands each decorator the command composed so far', () => {
        const registry = registryWithCore();
        const seen: Array<string[] | undefined> = [];
        const observer = (id: string) =>
            defineCliPlugin({
                id,
                commands: [],
                extendCommands: [
                    {
                        command: 'dev',
                        options: [{ long: `--${id.replace(/\W/g, '')}`, description: 'Marker' }],
                        decorate: ({ command, next }) => {
                            seen.push(command.options?.map(option => option.long));
                            return next;
                        },
                    },
                ],
            });

        registry.applyPlugin(observer('first'));
        registry.applyPlugin(observer('second'));

        expect(seen).toEqual([['--no-reload'], ['--no-reload', '--first']]);
    });

    it('does not mutate the command it extends', async () => {
        const original = coreDev();
        const originalAction = original.action;
        const registry = new CommandRegistry();
        registry.registerAll([original]);
        registry.applyPlugin(platformPlugin());

        expect(original.options?.map(option => option.long)).toEqual(['--no-reload']);
        expect(original.action).toBe(originalAction);
        expect(original.description).toBe('Run Vendure in development mode');

        await original.action('worker');
        expect(trace).toEqual(['core:worker']);
    });

    it('takes the description from the last plugin that sets one, with a notice', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());
        registry.applyPlugin(
            defineCliPlugin({
                id: CLOUD_ID,
                commands: [],
                extendCommands: [{ command: 'dev', description: 'Run against Vendure Cloud' }],
            }),
        );

        expect(devCommand(registry).description).toBe('Run against Vendure Cloud');
        const written = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(written).toContain(`Description of "vendure dev" set by ${CLOUD_ID}`);
        expect(written).toContain(PLATFORM_ID);
        writeSpy.mockRestore();
    });

    it('extends a nested command', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/nested',
                commands: [],
                extendCommands: [
                    {
                        command: ['config', 'server'],
                        options: [{ long: '--dry-run', description: 'Do not write' }],
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('nested:before');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        const group = registry.get('config') as CliCommandGroupDefinition;
        const leaf = group.subcommands[0] as CliCommandDefinition;
        expect(leaf.options?.map(option => option.long)).toEqual(['--dry-run']);
        await leaf.action();
        expect(trace).toEqual(['nested:before']);
    });

    it('accepts a space-separated command path', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/nested',
                commands: [],
                extendCommands: [
                    {
                        command: 'config server',
                        options: [{ long: '--dry-run', description: 'Do not write' }],
                    },
                ],
            }),
        );

        const group = registry.get('config') as CliCommandGroupDefinition;
        expect((group.subcommands[0] as CliCommandDefinition).options).toHaveLength(1);
    });

    it('adds an optional argument', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/args',
                commands: [],
                extendCommands: [
                    {
                        command: 'dev',
                        arguments: [{ name: 'profile', description: 'Profile', required: false }],
                    },
                ],
            }),
        );

        expect(devCommand(registry).arguments?.map(argument => argument.name)).toEqual(['target', 'profile']);
    });
});

describe('Command extensions: registration through Commander', () => {
    afterEach(() => {
        trace.length = 0;
    });

    it('exposes every plugin option and runs the whole chain', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());
        registry.applyPlugin(cloudPlugin());

        const help = await runCli(registry.toArray(), registry.getRootOptions(), ['dev', '--help']);
        expect(help.stdout).toContain('--rotate-credential');
        expect(help.stdout).toContain('--cloud-env');
        expect(help.stdout).toContain('--no-reload');
        expect(help.stdout).toContain('Run Vendure in development mode with linked Platform credentials');

        const run = await runCli(registry.toArray(), registry.getRootOptions(), [
            'dev',
            'server',
            '--rotate-credential',
            '--cloud-env',
            'staging',
        ]);
        expect(run.exitCode).toBe(0);
        expect(trace).toEqual([
            'cloud:before',
            'platform:before',
            'core:server',
            'platform:after',
            'cloud:after',
        ]);
    });

    it('keeps the exit code of the innermost command', async () => {
        const registry = new CommandRegistry();
        registry.registerAll([{ name: 'dev', description: 'Dev', action: async () => 7 }]);
        registry.applyPlugin(platformPlugin());

        const run = await runCli(registry.toArray(), [], ['dev']);

        expect(run.exitCode).toBe(7);
        expect(trace).toEqual(['platform:before', 'platform:after']);
    });
});

describe('Command extensions: collisions', () => {
    it('rejects an extension of a command that is not registered', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/missing',
            commands: [],
            extendCommands: [{ command: 'nope', options: [{ long: '--x', description: 'X' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/No command is registered at "vendure nope"/);
    });

    it('rejects an extension of a nested path that is not registered', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/missing',
            commands: [],
            extendCommands: [{ command: ['config', 'client'], options: [{ long: '--x', description: 'X' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(
            /No command is registered at "vendure config client"/,
        );
    });

    it('rejects decorating a command group', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/group',
            commands: [],
            extendCommands: [{ command: 'config', decorate: ({ next }) => next }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/is a command group and has no action/);
    });

    it('allows extending a command group with a shared option', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/group',
                commands: [],
                extendCommands: [
                    { command: 'config', options: [{ long: '--profile <name>', description: 'Profile' }] },
                ],
            }),
        );

        expect((registry.get('config') as CliCommandGroupDefinition).options).toHaveLength(1);
    });

    it('rejects an option that the target already declares', () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());

        const rival = defineCliPlugin({
            id: '@example/rival',
            commands: [],
            extendCommands: [
                { command: 'dev', options: [{ long: '--rotate-credential', description: 'Mine' }] },
            ],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(
            /already declared on "vendure dev" \(contributed by the CLI, @vendure-platform\/cli\)/,
        );
        expect(registry.getExtendedBy('dev')).toEqual([PLATFORM_ID]);
    });

    it('rejects an added option that uses a flag reserved by the CLI', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/greedy',
            commands: [],
            extendCommands: [{ command: 'dev', options: [{ long: '--help', description: 'Custom' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
    });

    it('rejects extending the reserved plugins command', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/hijack',
            commands: [],
            extendCommands: [{ command: 'plugins', decorate: () => async () => 0 }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
        expect(registry.has('plugins')).toBe(true);
    });

    it('rejects replacing the reserved plugins command', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/hijack',
            commands: [{ name: 'plugins', description: 'Mine', replaces: true, action: async () => 0 }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
        expect(registry.get('plugins')?.description).toBe('Manage CLI plugins');
    });

    it('rejects replacing a command that another plugin has extended', () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());

        const replacer = defineCliPlugin({
            id: '@example/replacer',
            commands: [{ name: 'dev', description: 'My dev', replaces: true, action: async () => 0 }],
        });

        expect(() => registry.applyPlugin(replacer)).toThrow(/has been extended by @vendure-platform\/cli/);
        expect(devCommand(registry).description).toContain('Platform credentials');
    });

    it('extends a replacement when the replacing plugin is listed first', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/replacer',
                commands: [
                    {
                        name: 'dev',
                        description: 'My dev',
                        replaces: true,
                        action: async () => {
                            trace.push('replacement');
                            return 0;
                        },
                    },
                ],
            }),
        );
        registry.applyPlugin(platformPlugin());

        await devCommand(registry).action();

        expect(trace).toEqual(['platform:before', 'replacement', 'platform:after']);
        trace.length = 0;
    });

    it('rejects an argument name the target already declares', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/args',
            commands: [],
            extendCommands: [{ command: 'dev', arguments: [{ name: 'target', description: 'Mine' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/Argument "target" is already declared/);
    });

    it('reports a decorator that throws while being applied, and applies nothing', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/broken',
            commands: [{ name: 'extra', description: 'Extra', action: async () => 0 }],
            extendCommands: [
                {
                    command: 'dev',
                    decorate: () => {
                        throw new Error('decorator blew up');
                    },
                },
            ],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/decorator blew up/);
        expect(registry.has('extra')).toBe(false);
        expect(registry.getExtendedBy('dev')).toEqual([]);
        expect(registry.has('plugins')).toBe(true);
    });

    it('reports a decorator that does not return a function', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/broken',
            commands: [],
            extendCommands: [{ command: 'dev', decorate: () => undefined as any }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/must return an action function/);
    });

    it('keeps earlier plugins intact when a later one is rejected', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(platformPlugin());
        const broken = defineCliPlugin({
            id: '@example/broken',
            commands: [],
            extendCommands: [{ command: 'dev', options: [{ long: '--help', description: 'Custom' }] }],
        });

        expect(() => registry.applyPlugin(broken)).toThrow(CliPluginRegistrationError);

        await devCommand(registry).action('server');
        expect(trace).toEqual(['platform:before', 'core:server', 'platform:after']);
        trace.length = 0;
    });
});

describe('defineCliPlugin() with command extensions', () => {
    it('rejects an extension that adds nothing', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/empty',
                commands: [],
                extendCommands: [{ command: 'dev' }],
            }),
        ).toThrow(/adds nothing/);
    });

    it('rejects an extension without a command path', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/empty',
                commands: [],
                extendCommands: [{ command: '  ', decorate: ({ next }) => next }],
            }),
        ).toThrow(/without a command path/);
    });

    it('rejects two extensions of the same command', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/twice',
                commands: [],
                extendCommands: [
                    { command: 'dev', options: [{ long: '--a', description: 'A' }] },
                    { command: 'dev', options: [{ long: '--b', description: 'B' }] },
                ],
            }),
        ).toThrow(/extends "dev" more than once/);
    });

    it('rejects an extension that adds a required argument', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/args',
                commands: [],
                extendCommands: [
                    {
                        command: 'dev',
                        arguments: [{ name: 'profile', description: 'Profile', required: true }],
                    },
                ],
            }),
        ).toThrow(/adds a required argument/);
    });

    it('rejects an added option that shadows one of the plugin shared options', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/shadow',
                rootOptions: [{ long: '--token <token>', description: 'API token', required: true }],
                commands: [],
                extendCommands: [
                    {
                        command: 'dev',
                        options: [{ long: '--token <token>', description: 'Override', required: true }],
                    },
                ],
            }),
        ).toThrow(/already a shared option/);
    });

    it('rejects a non-function decorate', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/broken',
                commands: [],
                extendCommands: [{ command: 'dev', decorate: 'nope' as any }],
            }),
        ).toThrow(/non-function decorate/);
    });

    it('accepts an extension that only adds options', () => {
        const plugin = defineCliPlugin({
            id: '@example/options',
            commands: [],
            extendCommands: [{ command: 'dev', options: [{ long: '--x', description: 'X' }] }],
        });

        expect(plugin.extendCommands).toHaveLength(1);
    });
});

const _typeCheck: CliCommandNode[] = [coreDev()];
