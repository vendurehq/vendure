import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from './__tests__/run-cli';
import { CliCommandDefinition, CliCommandGroupDefinition, CliCommandOption } from './cli-command-definition';
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
        expect((group.subcommands[0] as CliCommandDefinition).options?.map(o => o.long)).toEqual([
            '--dry-run',
        ]);
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
    afterEach(() => {
        trace.length = 0;
    });

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

        expect((registry.get('config') as CliCommandGroupDefinition).options?.map(o => o.long)).toEqual([
            '--profile <name>',
        ]);
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
            /Option "--rotate-credential" is already declared on "vendure dev"/,
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

    it('rejects a group that redeclares one of the plugin shared options', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/shadow',
                rootOptions: [{ long: '--token <token>', description: 'API token', required: true }],
                commands: [
                    {
                        name: 'group',
                        description: 'Group',
                        options: [{ long: '--token <token>', description: 'Override', required: true }],
                        subcommands: [{ name: 'run', description: 'Run', action: async () => 0 }],
                    },
                ],
            }),
        ).toThrow(/already a shared option/);
    });

    it('allows a command to repeat a shared option, which the host keeps in step', () => {
        const plugin = defineCliPlugin({
            id: '@example/repeat',
            rootOptions: [{ long: '--token <token>', description: 'API token', required: true }],
            commands: [
                {
                    name: 'thing',
                    description: 'Thing',
                    options: [{ long: '--token <token>', description: 'Same value', required: true }],
                    action: async () => 0,
                },
            ],
        });

        expect(plugin.commands).toHaveLength(1);
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

    it('applies an extension that only adds options', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/options',
                commands: [],
                extendCommands: [{ command: 'dev', options: [{ long: '--x', description: 'X' }] }],
            }),
        );

        expect(devCommand(registry).options?.map(option => option.long)).toEqual(['--no-reload', '--x']);
    });
});

describe('Command extensions: plugin-provided commands', () => {
    afterEach(() => {
        trace.length = 0;
    });

    function providerPlugin() {
        return defineCliPlugin({
            id: '@a/provider',
            commands: [
                {
                    name: 'cloud',
                    description: 'Cloud utilities',
                    options: [{ long: '--region <r>', description: 'Region', required: true }],
                    action: async () => {
                        trace.push('provider');
                        return 0;
                    },
                },
            ],
        });
    }

    it('extends a command an earlier plugin added', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(providerPlugin());
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/extender',
                commands: [],
                extendCommands: [
                    {
                        command: 'cloud',
                        options: [{ long: '--verbose', description: 'Verbose' }],
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('extender');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        const cloud = registry.get('cloud') as CliCommandDefinition;
        expect(cloud.options?.map(option => option.long)).toEqual(['--region <r>', '--verbose']);
        await cloud.action();
        expect(trace).toEqual(['extender', 'provider']);
        expect(registry.getExtendedBy('cloud')).toEqual(['@b/extender']);
    });

    it('extends a nested command an earlier plugin added', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/provider',
                commands: [
                    {
                        name: 'project',
                        description: 'Projects',
                        subcommands: [
                            {
                                name: 'list',
                                description: 'List projects',
                                action: async () => {
                                    trace.push('provider');
                                    return 0;
                                },
                            },
                        ],
                    },
                ],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/extender',
                commands: [],
                extendCommands: [
                    {
                        command: 'project list',
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('extender');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        const group = registry.get('project') as CliCommandGroupDefinition;
        await (group.subcommands[0] as CliCommandDefinition).action();
        expect(trace).toEqual(['extender', 'provider']);
    });

    it('extends a command the same plugin adds', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/self',
                commands: [
                    {
                        name: 'solo',
                        description: 'Solo',
                        action: async () => {
                            trace.push('own');
                            return 0;
                        },
                    },
                ],
                extendCommands: [
                    {
                        command: 'solo',
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('own-wrapper');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        await (registry.get('solo') as CliCommandDefinition).action();
        expect(trace).toEqual(['own-wrapper', 'own']);
    });

    it('rejects extending a command only a later plugin would provide', () => {
        const registry = registryWithCore();
        const extender = defineCliPlugin({
            id: '@b/extender',
            commands: [],
            extendCommands: [{ command: 'cloud', options: [{ long: '--verbose', description: 'V' }] }],
        });

        expect(() => registry.applyPlugin(extender)).toThrow(/No command is registered at "vendure cloud"/);
    });
});

describe('Command extensions: nested composition', () => {
    afterEach(() => {
        trace.length = 0;
    });

    function nestedProvider() {
        return defineCliPlugin({
            id: '@a/provider',
            commands: [
                {
                    name: 'console',
                    description: 'Console commands',
                    subcommands: [
                        {
                            name: 'link',
                            description: 'Link the project',
                            action: async () => {
                                trace.push('core-link');
                                return 0;
                            },
                        },
                    ],
                },
            ],
        });
    }

    function nestedExtender(id: string, flag: string) {
        return defineCliPlugin({
            id,
            commands: [],
            extendCommands: [
                {
                    command: ['console', 'link'],
                    options: [{ long: flag, description: `Added by ${id}` }],
                    decorate:
                        ({ next }) =>
                        async (...args: any[]) => {
                            trace.push(`${id}:before`);
                            try {
                                return await next(...args);
                            } finally {
                                trace.push(`${id}:after`);
                            }
                        },
                },
            ],
        });
    }

    it('composes two plugins at a nested path, last listed outermost', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(nestedProvider());
        registry.applyPlugin(nestedExtender('@b/first', '--first'));
        registry.applyPlugin(nestedExtender('@c/second', '--second'));

        const group = registry.get('console') as CliCommandGroupDefinition;
        await (group.subcommands[0] as CliCommandDefinition).action();

        expect(trace).toEqual([
            '@c/second:before',
            '@b/first:before',
            'core-link',
            '@b/first:after',
            '@c/second:after',
        ]);
    });

    it('merges both plugins options into the nested command help', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(nestedProvider());
        registry.applyPlugin(nestedExtender('@b/first', '--first'));
        registry.applyPlugin(nestedExtender('@c/second', '--second'));

        const help = await runCli(registry.toArray(), registry.getRootOptions(), [
            'console',
            'link',
            '--help',
        ]);

        expect(help.stdout).toContain('--first');
        expect(help.stdout).toContain('--second');
    });

    it('rejects a second plugin adding an option the nested command already has', () => {
        const registry = registryWithCore();
        registry.applyPlugin(nestedProvider());
        registry.applyPlugin(nestedExtender('@b/first', '--first'));

        expect(() => registry.applyPlugin(nestedExtender('@c/second', '--first'))).toThrow(
            /Option "--first" is already declared on "vendure console link"/,
        );
    });
});

describe('Command extensions: reserved names and shared-option scope', () => {
    it('rejects a plugin command that declares a reserved flag', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/greedy',
            commands: [
                {
                    name: 'thing',
                    description: 'Thing',
                    options: [{ long: '--help', description: 'Mine' }],
                    action: async () => 0,
                },
            ],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
        expect(registry.has('thing')).toBe(false);
    });

    it('rejects a plugin command named help', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/hijack',
            commands: [{ name: 'help', description: 'Mine', action: async () => 0 }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
        expect(registry.has('help')).toBe(false);
    });

    it('rejects a group option that another plugin already shares at the root', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/root',
                rootOptions: [{ long: '--token <t>', description: 'Token', required: true }],
                commands: [{ name: 'a', description: 'A', action: async () => 0 }],
            }),
        );

        const rival = defineCliPlugin({
            id: '@b/group',
            commands: [
                {
                    name: 'g',
                    description: 'G',
                    options: [{ long: '--token <t>', description: 'Mine', required: true }],
                    subcommands: [{ name: 'run', description: 'Run', action: async () => 0 }],
                },
            ],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(/cannot be shared at two levels/);
        expect(registry.has('g')).toBe(false);
    });

    it('rejects an extension whose option disagrees with an ancestor group option', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/provider',
                commands: [
                    {
                        name: 'settings',
                        description: 'Settings',
                        options: [{ long: '--profile <n>', description: 'Profile', required: true }],
                        subcommands: [{ name: 'set', description: 'Set', action: async () => 0 }],
                    },
                ],
            }),
        );

        const shadow = defineCliPlugin({
            id: '@b/shadow',
            commands: [],
            extendCommands: [
                { command: 'settings set', options: [{ long: '--profile', description: 'Mine' }] },
            ],
        });

        expect(() => registry.applyPlugin(shadow)).toThrow(/one takes a value and the other does not/);
    });

    it('rejects an extension adding an option a group already shares', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/provider',
                commands: [
                    {
                        name: 'settings',
                        description: 'Settings',
                        options: [{ long: '--profile <n>', description: 'Profile', required: true }],
                        subcommands: [
                            {
                                name: 'nested',
                                description: 'Nested',
                                subcommands: [{ name: 'set', description: 'Set', action: async () => 0 }],
                            },
                        ],
                    },
                ],
            }),
        );

        const shadow = defineCliPlugin({
            id: '@b/shadow',
            commands: [],
            extendCommands: [
                {
                    command: 'settings nested',
                    options: [{ long: '--profile <n>', description: 'Mine', required: true }],
                },
            ],
        });

        expect(() => registry.applyPlugin(shadow)).toThrow(/cannot be shared at two levels/);
    });

    it('lets a supplied value beat a group default', async () => {
        let inherited: Record<string, any> | undefined;
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/root',
                rootOptions: [{ long: '--env <e>', description: 'Environment', required: true }],
                commands: [
                    {
                        name: 'g',
                        description: 'G',
                        subcommands: [
                            {
                                name: 'run',
                                description: 'Run',
                                action: async (...args: any[]) => {
                                    inherited = args[args.length - 1].inheritedOptions;
                                    return 0;
                                },
                            },
                        ],
                    },
                ],
            }),
        );

        await runCli(registry.toArray(), registry.getRootOptions(), ['--env', 'staging', 'g', 'run']);

        expect(inherited).toEqual({ env: 'staging' });
    });
});

describe('Command extensions: sub-options and description ownership', () => {
    it('rejects a shared option whose sub-option uses a reserved flag', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/sneaky',
            rootOptions: [
                {
                    long: '--mode <m>',
                    description: 'Mode',
                    required: true,
                    subOptions: [{ long: '--help', description: 'Sneaky' }],
                },
            ],
            commands: [{ name: 'thing', description: 'Thing', action: async () => 0 }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
        expect(registry.has('thing')).toBe(false);
    });

    it('rejects a sub-option that another plugin already shares', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/first',
                rootOptions: [
                    {
                        long: '--a <v>',
                        description: 'A',
                        required: true,
                        subOptions: [{ long: '--shared <v>', description: 'Shared', required: true }],
                    },
                ],
                commands: [{ name: 'ca', description: 'CA', action: async () => 0 }],
            }),
        );

        const rival = defineCliPlugin({
            id: '@b/second',
            rootOptions: [
                {
                    long: '--b <v>',
                    description: 'B',
                    required: true,
                    subOptions: [{ long: '--shared <v>', description: 'Mine', required: true }],
                },
            ],
            commands: [{ name: 'cb', description: 'CB', action: async () => 0 }],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(/already registered by @a\/first/);
        expect(registry.has('cb')).toBe(false);
    });

    it('rejects a command sub-option that uses a reserved flag', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/sneaky',
            commands: [
                {
                    name: 'thing',
                    description: 'Thing',
                    options: [
                        {
                            long: '--mode <m>',
                            description: 'Mode',
                            required: true,
                            subOptions: [{ long: '-h', description: 'Sneaky' }],
                        },
                    ],
                    action: async () => 0,
                },
            ],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
    });

    it('records description ownership per command, not per tree', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/provider',
                commands: [
                    {
                        name: 'config',
                        description: 'Config',
                        subcommands: [
                            { name: 'server', description: 'Server', action: async () => 0 },
                            { name: 'database', description: 'Database', action: async () => 0 },
                        ],
                    },
                ],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/first',
                commands: [],
                extendCommands: [{ command: 'config server', description: 'Server by B' }],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@c/second',
                commands: [],
                extendCommands: [{ command: 'config database', description: 'Database by C' }],
            }),
        );

        // Two different commands were described, so nothing was replaced.
        const written = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(written).not.toContain('Description of');
        writeSpy.mockRestore();
    });

    it('still reports a replacement when the same command is described twice', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/provider',
                commands: [
                    {
                        name: 'config',
                        description: 'Config',
                        subcommands: [{ name: 'server', description: 'Server', action: async () => 0 }],
                    },
                ],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/first',
                commands: [],
                extendCommands: [{ command: 'config server', description: 'Server by B' }],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@c/second',
                commands: [],
                extendCommands: [{ command: 'config server', description: 'Server by C' }],
            }),
        );

        const written = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(written).toContain('Description of "vendure config server" set by @c/second');
        expect(written).toContain('@b/first');
        writeSpy.mockRestore();
    });
});

describe('Command extensions: shared-option scope is order-independent', () => {
    function groupPlugin() {
        return defineCliPlugin({
            id: '@a/group',
            commands: [
                {
                    name: 'settings',
                    description: 'Settings',
                    options: [{ long: '--profile <n>', description: 'Profile', required: true }],
                    subcommands: [{ name: 'set', description: 'Set', action: async () => 0 }],
                },
            ],
        });
    }

    function rootPlugin() {
        return defineCliPlugin({
            id: '@b/root',
            rootOptions: [{ long: '--profile <n>', description: 'Profile', required: true }],
            commands: [{ name: 'other', description: 'Other', action: async () => 0 }],
        });
    }

    it('rejects a root option that a group already shares', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(groupPlugin());

        expect(() => registry.applyPlugin(rootPlugin())).toThrow(/cannot be shared at two levels/);
        expect(registry.has('other')).toBe(false);
    });

    it('rejects a group option that the root already shares', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(rootPlugin());

        expect(() => registry.applyPlugin(groupPlugin())).toThrow(/cannot be shared at two levels/);
        expect(registry.has('settings')).toBe(false);
    });

    it('rejects an extension adding a flag a descendant group already shares', () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/tree',
                commands: [
                    {
                        name: 'settings',
                        description: 'Settings',
                        subcommands: [
                            {
                                name: 'nested',
                                description: 'Nested',
                                options: [{ long: '--profile <n>', description: 'Profile', required: true }],
                                subcommands: [{ name: 'set', description: 'Set', action: async () => 0 }],
                            },
                        ],
                    },
                ],
            }),
        );

        const shadow = defineCliPlugin({
            id: '@b/ext',
            commands: [],
            extendCommands: [
                {
                    command: 'settings',
                    options: [{ long: '--profile <n>', description: 'Mine', required: true }],
                },
            ],
        });

        expect(() => registry.applyPlugin(shadow)).toThrow(
            /already shared by "vendure settings nested" below it/,
        );
    });
});

describe('Command extensions: sub-option depth', () => {
    it('rejects sub-options nested more than one level', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/deep',
                commands: [
                    {
                        name: 'deep',
                        description: 'Deep',
                        options: [
                            {
                                long: '--a <v>',
                                description: 'A',
                                required: true,
                                subOptions: [
                                    {
                                        long: '--b <v>',
                                        description: 'B',
                                        required: true,
                                        subOptions: [{ long: '--c <v>', description: 'C', required: true }],
                                    },
                                ],
                            },
                        ],
                        action: async () => 0,
                    },
                ],
            }),
        ).toThrow(/nests sub-options more than one level deep/);
    });

    it('registers a one-level sub-option so Commander can parse it', async () => {
        let seen: Record<string, any> | undefined;
        const registry = new CommandRegistry();
        registry.registerAll([
            {
                name: 'deep',
                description: 'Deep',
                options: [
                    {
                        long: '--a <v>',
                        description: 'A',
                        required: true,
                        subOptions: [{ long: '--b <v>', description: 'B', required: true }],
                    },
                ],
                action: async (options: Record<string, any>) => {
                    seen = options;
                    return 0;
                },
            },
        ]);

        const run = await runCli(registry.toArray(), [], ['deep', '--a', '1', '--b', '2']);

        expect(run.exitCode).toBe(0);
        expect(seen).toMatchObject({ a: '1', b: '2' });
    });
});

describe('Command extensions: the decorator cannot reach the registered command', () => {
    it('rejects a decorator that mutates the command it is given', () => {
        const original = coreDev();
        const optionCount = original.options?.length ?? 0;
        const registry = new CommandRegistry();
        registry.registerAll([original]);

        const naughty = defineCliPlugin({
            id: '@example/naughty',
            commands: [],
            extendCommands: [
                {
                    command: 'dev',
                    decorate: ({ command, next }) => {
                        (command.options as CliCommandOption[]).push({
                            long: '--injected',
                            description: 'Injected',
                        });
                        return next;
                    },
                },
            ],
        });

        expect(() => registry.applyPlugin(naughty)).toThrow(/Extending "vendure dev" failed/);
        expect(original.options?.length).toBe(optionCount);
    });
});
