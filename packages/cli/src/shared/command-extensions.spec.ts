import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from './__tests__/run-cli.js';
import {
    CliCommandDefinition,
    CliCommandGroupDefinition,
    CliCommandNode,
    CliCommandOption,
    readCommandContext,
} from './cli-command-definition.js';
import { assertCommandTree, defineCliPlugin } from './cli-plugin.js';
import { CliPluginRegistrationError, CommandRegistry } from './command-registry-store.js';

/**
 * Records the order in which the built-in and each plugin wrapper runs, so a
 * test can assert that every wrapper ran exactly once and in which order.
 */
const trace: string[] = [];

beforeEach(() => {
    trace.length = 0;
});

const CREDENTIALS_ID = '@example/credentials-cli-plugin';
const TELEMETRY_ID = '@example/telemetry-cli-plugin';

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
 * A plugin that adds an option to `dev` and wraps its action, calling the
 * action it was handed rather than importing the built-in one.
 */
function credentialsPlugin() {
    return defineCliPlugin({
        id: CREDENTIALS_ID,
        extendCommands: [
            {
                command: 'dev',
                description: 'Run Vendure in development mode with linked credentials',
                options: [{ long: '--rotate-credential', description: 'Replace the active credential' }],
                decorate:
                    ({ next }) =>
                    async (...args: any[]) => {
                        trace.push('credentials:before');
                        const code = await next(...args);
                        trace.push('credentials:after');
                        return code;
                    },
            },
        ],
    });
}

function telemetryPlugin() {
    return defineCliPlugin({
        id: TELEMETRY_ID,
        extendCommands: [
            {
                command: 'dev',
                options: [{ long: '--cloud-env <name>', description: 'Cloud environment', required: true }],
                decorate:
                    ({ next }) =>
                    async (...args: any[]) => {
                        trace.push('telemetry:before');
                        const code = await next(...args);
                        trace.push('telemetry:after');
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
    it('runs every wrapper exactly once, outermost first', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(credentialsPlugin());
        registry.applyPlugin(telemetryPlugin());

        await devCommand(registry).action('server');

        expect(trace).toEqual([
            'telemetry:before',
            'credentials:before',
            'core:server',
            'credentials:after',
            'telemetry:after',
        ]);
    });

    it('follows vendure.cli.plugins order, so the last listed plugin is outermost', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(telemetryPlugin());
        registry.applyPlugin(credentialsPlugin());

        await devCommand(registry).action('server');

        expect(trace).toEqual([
            'credentials:before',
            'telemetry:before',
            'core:server',
            'telemetry:after',
            'credentials:after',
        ]);
    });

    it('records which plugins extended the command, in application order', () => {
        const registry = registryWithCore();
        registry.applyPlugin(credentialsPlugin());
        registry.applyPlugin(telemetryPlugin());

        expect(registry.getExtendedBy('dev')).toEqual([CREDENTIALS_ID, TELEMETRY_ID]);
    });

    it('keeps the options contributed by every plugin', () => {
        const registry = registryWithCore();
        registry.applyPlugin(credentialsPlugin());
        registry.applyPlugin(telemetryPlugin());

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
        registry.applyPlugin(credentialsPlugin());

        expect(original.options?.map(option => option.long)).toEqual(['--no-reload']);
        expect(original.action).toBe(originalAction);
        expect(original.description).toBe('Run Vendure in development mode');

        await original.action('worker');
        expect(trace).toEqual(['core:worker']);
    });

    it('takes the description from the last plugin that sets one, with a notice', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const registry = registryWithCore();
        registry.applyPlugin(credentialsPlugin());
        registry.applyPlugin(
            defineCliPlugin({
                id: TELEMETRY_ID,
                extendCommands: [{ command: 'dev', description: 'Run against Vendure Cloud' }],
            }),
        );

        expect(devCommand(registry).description).toBe('Run against Vendure Cloud');
        const written = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(written).toContain(`Description of "vendure dev" set by ${TELEMETRY_ID}`);
        expect(written).toContain(CREDENTIALS_ID);
        writeSpy.mockRestore();
    });

    it('extends a nested command', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/nested',
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
    it('exposes every plugin option and runs the whole chain', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(credentialsPlugin());
        registry.applyPlugin(telemetryPlugin());

        const help = await runCli(registry.getCommandTree(), registry.getRootOptions(), ['dev', '--help']);
        expect(help.stdout).toContain('--rotate-credential');
        expect(help.stdout).toContain('--cloud-env');
        expect(help.stdout).toContain('--no-reload');
        expect(help.stdout).toContain('Run Vendure in development mode with linked credentials');

        const run = await runCli(registry.getCommandTree(), registry.getRootOptions(), [
            'dev',
            'server',
            '--rotate-credential',
            '--cloud-env',
            'staging',
        ]);
        expect(run.exitCode).toBe(0);
        expect(trace).toEqual([
            'telemetry:before',
            'credentials:before',
            'core:server',
            'credentials:after',
            'telemetry:after',
        ]);
    });

    it('keeps the exit code of the innermost command', async () => {
        const registry = new CommandRegistry();
        registry.registerAll([{ name: 'dev', description: 'Dev', action: async () => 7 }]);
        registry.applyPlugin(credentialsPlugin());

        const run = await runCli(registry.getCommandTree(), [], ['dev']);

        expect(run.exitCode).toBe(7);
        expect(trace).toEqual(['credentials:before', 'credentials:after']);
    });
});

describe('Command extensions: collisions', () => {
    // `vendure dev` is declared with defineCommand, which extendCommands cannot reach.
    it('skips only the extension of a command the CLI declares with defineCommand, with a warning', () => {
        const registry = new CommandRegistry();
        registry.setHostDeclaredCommands([['dev'], ['migrate', 'generate']], ['dev', 'server']);
        const plugin = defineCliPlugin({
            id: '@example/dev-extender',
            extendCommands: [{ command: 'dev', options: [{ long: '--x', description: 'X' }] }],
        });
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            registry.applyPlugin(plugin);
            expect(stderr).toHaveBeenCalledWith(
                expect.stringContaining(
                    'Skipped the extension of "vendure dev" from @example/dev-extender: the command is declared with defineCommand',
                ),
            );
        } finally {
            stderr.mockRestore();
        }
    });

    // `vendure console` is a group of commands declared with defineCommand.
    it('skips the extension of a group whose commands the CLI declares with defineCommand', () => {
        const registry = new CommandRegistry();
        registry.setHostDeclaredCommands(
            [
                ['console', 'link'],
                ['console', 'status'],
            ],
            ['console', 'link'],
        );
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            registry.applyPlugin(
                defineCliPlugin({
                    id: '@example/console-extender',
                    extendCommands: [{ command: 'console', options: [{ long: '--x', description: 'X' }] }],
                }),
            );
            expect(stderr).toHaveBeenCalledWith(
                expect.stringContaining(
                    'Skipped the extension of "vendure console" from @example/console-extender',
                ),
            );
        } finally {
            stderr.mockRestore();
        }
    });

    it('warns about a skipped extension only when its command runs', () => {
        const registry = new CommandRegistry();
        registry.setHostDeclaredCommands([['dev']], ['doctor', '--json']);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            registry.applyPlugin(
                defineCliPlugin({
                    id: '@example/dev-extender',
                    extendCommands: [{ command: 'dev', options: [{ long: '--x', description: 'X' }] }],
                }),
            );
            expect(stderr).not.toHaveBeenCalled();
        } finally {
            stderr.mockRestore();
        }
    });

    it('rejects an extension of a command that is not registered', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/missing',
            extendCommands: [{ command: 'nope', options: [{ long: '--x', description: 'X' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(
            /No built-in command is registered at "vendure nope"/,
        );
    });

    it('rejects an extension of a nested path that is not registered', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/missing',
            extendCommands: [{ command: ['config', 'client'], options: [{ long: '--x', description: 'X' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(
            /No built-in command is registered at "vendure config client"/,
        );
    });

    it('rejects decorating a command group', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/group',
            extendCommands: [{ command: 'config', decorate: ({ next }) => next }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/is a command group and has no action/);
    });

    it('allows extending a command group with a shared option', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/group',
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
        registry.applyPlugin(credentialsPlugin());

        const rival = defineCliPlugin({
            id: '@example/rival',
            extendCommands: [
                { command: 'dev', options: [{ long: '--rotate-credential', description: 'Mine' }] },
            ],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(
            /Option "--rotate-credential" is already declared on "vendure dev"/,
        );
        expect(registry.getExtendedBy('dev')).toEqual([CREDENTIALS_ID]);
    });

    it('rejects an added option that uses a flag reserved by the CLI', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/greedy',
            extendCommands: [{ command: 'dev', options: [{ long: '--help', description: 'Custom' }] }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
    });

    it('rejects extending the reserved plugins command', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/hijack',
            extendCommands: [{ command: 'plugins', decorate: () => async () => 0 }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
        expect(registry.has('plugins')).toBe(true);
    });

    it('reports a decorator that throws while being applied, and applies nothing', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/broken',
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
        expect(registry.getExtendedBy('dev')).toEqual([]);
        expect(registry.has('plugins')).toBe(true);
    });

    it('reports a decorator that does not return a function', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/broken',
            extendCommands: [{ command: 'dev', decorate: () => undefined as any }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/must return an action function/);
    });

    it('keeps earlier plugins intact when a later one is rejected', async () => {
        const registry = registryWithCore();
        registry.applyPlugin(credentialsPlugin());
        const broken = defineCliPlugin({
            id: '@example/broken',
            extendCommands: [{ command: 'dev', options: [{ long: '--help', description: 'Custom' }] }],
        });

        expect(() => registry.applyPlugin(broken)).toThrow(CliPluginRegistrationError);

        await devCommand(registry).action('server');
        expect(trace).toEqual(['credentials:before', 'core:server', 'credentials:after']);
    });
});

describe('defineCliPlugin() with command extensions', () => {
    it('rejects an extension that adds nothing', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/empty',
                extendCommands: [{ command: 'dev' }],
            }),
        ).toThrow(/adds nothing/);
    });

    it('rejects an extension without a command path', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/empty',
                extendCommands: [{ command: '  ', decorate: ({ next }) => next }],
            }),
        ).toThrow(/without a command path/);
    });

    it('rejects two extensions of the same command', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/twice',
                extendCommands: [
                    { command: 'dev', options: [{ long: '--a', description: 'A' }] },
                    { command: 'dev', options: [{ long: '--b', description: 'B' }] },
                ],
            }),
        ).toThrow(/extends "dev" more than once/);
    });

    it('allows a command to repeat a shared option of the same shape', () => {
        const registry = registryWithCore();
        registry.register({
            name: 'thing',
            description: 'Thing',
            options: [{ long: '--token <token>', description: 'Same value', required: true }],
            action: async () => 0,
        });
        const plugin = defineCliPlugin({
            id: '@example/repeat',
            rootOptions: [{ long: '--token <token>', description: 'API token', required: true }],
        });

        expect(() => registry.applyPlugin(plugin)).not.toThrow();
        expect((registry.get('thing') as CliCommandDefinition).options?.map(o => o.long)).toEqual([
            '--token <token>',
        ]);
    });

    it('rejects a non-function decorate', () => {
        expect(() =>
            defineCliPlugin({
                id: '@example/broken',
                extendCommands: [{ command: 'dev', decorate: 'nope' as any }],
            }),
        ).toThrow(/non-function decorate/);
    });

    it('applies an extension that only adds options', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@example/options',
                extendCommands: [{ command: 'dev', options: [{ long: '--x', description: 'X' }] }],
            }),
        );

        expect(devCommand(registry).options?.map(option => option.long)).toEqual(['--no-reload', '--x']);
    });
});

describe('Command extensions: registered commands', () => {
    it('extends a registered command with options and a decorator', async () => {
        const registry = registryWithCore();
        registry.register({
            name: 'cloud',
            description: 'Cloud utilities',
            options: [{ long: '--region <r>', description: 'Region', required: true }],
            action: async () => {
                trace.push('core');
                return 0;
            },
        });
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/extender',
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
        expect(trace).toEqual(['extender', 'core']);
        expect(registry.getExtendedBy('cloud')).toEqual(['@b/extender']);
    });

    it('extends a registered nested command', async () => {
        const registry = registryWithCore();
        registry.register({
            name: 'project',
            description: 'Projects',
            subcommands: [
                {
                    name: 'list',
                    description: 'List projects',
                    action: async () => {
                        trace.push('core');
                        return 0;
                    },
                },
            ],
        });
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/extender',
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
        expect(trace).toEqual(['extender', 'core']);
    });
});

describe('Command extensions: nested composition', () => {
    function registerConsole(registry: CommandRegistry) {
        registry.register({
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
        });
    }

    function nestedExtender(id: string, flag: string) {
        return defineCliPlugin({
            id,
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
        registerConsole(registry);
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
        registerConsole(registry);
        registry.applyPlugin(nestedExtender('@b/first', '--first'));
        registry.applyPlugin(nestedExtender('@c/second', '--second'));

        const help = await runCli(registry.getCommandTree(), registry.getRootOptions(), [
            'console',
            'link',
            '--help',
        ]);

        expect(help.stdout).toContain('--first');
        expect(help.stdout).toContain('--second');
    });

    it('rejects a second plugin adding an option the nested command already has', () => {
        const registry = registryWithCore();
        registerConsole(registry);
        registry.applyPlugin(nestedExtender('@b/first', '--first'));

        expect(() => registry.applyPlugin(nestedExtender('@c/second', '--first'))).toThrow(
            /Option "--first" is already declared on "vendure console link"/,
        );
    });
});

describe('Command extensions: reserved names and shared-option scope', () => {
    it('rejects an extension whose option disagrees with an ancestor group option', () => {
        const registry = new CommandRegistry();
        registry.register({
            name: 'settings',
            description: 'Settings',
            options: [{ long: '--profile <n>', description: 'Profile', required: true }],
            subcommands: [{ name: 'set', description: 'Set', action: async () => 0 }],
        });

        const shadow = defineCliPlugin({
            id: '@b/shadow',
            extendCommands: [
                { command: 'settings set', options: [{ long: '--profile', description: 'Mine' }] },
            ],
        });

        expect(() => registry.applyPlugin(shadow)).toThrow(/one takes a value and the other does not/);
    });

    it('rejects an extension adding an option a group already shares', () => {
        const registry = new CommandRegistry();
        registry.register({
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
        });

        const shadow = defineCliPlugin({
            id: '@b/shadow',
            extendCommands: [
                {
                    command: 'settings nested',
                    options: [{ long: '--profile <n>', description: 'Mine', required: true }],
                },
            ],
        });

        expect(() => registry.applyPlugin(shadow)).toThrow(/cannot be shared at two levels/);
    });

    it('passes a supplied root option value to a nested command', async () => {
        let inherited: Record<string, any> | undefined;
        const registry = new CommandRegistry();
        registry.register({
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
        });
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/root',
                rootOptions: [{ long: '--env <e>', description: 'Environment', required: true }],
            }),
        );

        await runCli(registry.getCommandTree(), registry.getRootOptions(), ['--env', 'staging', 'g', 'run']);

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
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/reserved by the CLI/);
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
        });

        expect(() => registry.applyPlugin(rival)).toThrow(/already registered by @a\/first/);
    });

    it('records description ownership per command, not per tree', () => {
        const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const registry = new CommandRegistry();
        registry.register({
            name: 'config',
            description: 'Config',
            subcommands: [
                { name: 'server', description: 'Server', action: async () => 0 },
                { name: 'database', description: 'Database', action: async () => 0 },
            ],
        });
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/first',
                extendCommands: [{ command: 'config server', description: 'Server by B' }],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@c/second',
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
        registry.register({
            name: 'config',
            description: 'Config',
            subcommands: [{ name: 'server', description: 'Server', action: async () => 0 }],
        });
        registry.applyPlugin(
            defineCliPlugin({
                id: '@b/first',
                extendCommands: [{ command: 'config server', description: 'Server by B' }],
            }),
        );
        registry.applyPlugin(
            defineCliPlugin({
                id: '@c/second',
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
    function settingsGroup(): CliCommandGroupDefinition {
        return {
            name: 'settings',
            description: 'Settings',
            options: [{ long: '--profile <n>', description: 'Profile', required: true }],
            subcommands: [{ name: 'set', description: 'Set', action: async () => 0 }],
        };
    }

    function rootPlugin() {
        return defineCliPlugin({
            id: '@b/root',
            rootOptions: [{ long: '--profile <n>', description: 'Profile', required: true }],
        });
    }

    it('rejects a root option that a group already shares', () => {
        const registry = new CommandRegistry();
        registry.register(settingsGroup());

        expect(() => registry.applyPlugin(rootPlugin())).toThrow(/cannot be shared at two levels/);
    });

    it('rejects an extension adding a flag a descendant group already shares', () => {
        const registry = new CommandRegistry();
        registry.register({
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
        });

        const shadow = defineCliPlugin({
            id: '@b/ext',
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
            assertCommandTree('@example/deep', [
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
            ]),
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

        const run = await runCli(registry.getCommandTree(), [], ['deep', '--a', '1', '--b', '2']);

        expect(run.exitCode).toBe(0);
        expect(seen).toEqual({ a: '1', b: '2' });
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

describe('Command extensions: value shape across levels', () => {
    it('rejects a group extension whose flag disagrees with a leaf below it', () => {
        const registry = new CommandRegistry();
        registry.register({
            name: 'config',
            description: 'Config',
            subcommands: [
                {
                    name: 'server',
                    description: 'Server',
                    options: [{ long: '--dry-run', description: 'Boolean' }],
                    action: async () => 0,
                },
            ],
        });

        const rival = defineCliPlugin({
            id: '@b/ext',
            extendCommands: [
                {
                    command: 'config',
                    options: [{ long: '--dry-run <path>', description: 'Valued', required: true }],
                },
            ],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(/one takes a value and the other does not/);
    });

    it('rejects a leaf whose flag disagrees with its own group', () => {
        expect(() =>
            assertCommandTree('@a/one', [
                {
                    name: 'config',
                    description: 'Config',
                    options: [{ long: '--dry-run <path>', description: 'Valued', required: true }],
                    subcommands: [
                        {
                            name: 'server',
                            description: 'Server',
                            options: [{ long: '--dry-run', description: 'Boolean' }],
                            action: async () => 0,
                        },
                    ],
                },
            ]),
        ).toThrow(/one takes a value and the other does not/);
    });

    it('accepts a leaf repeating a group flag of the same shape', async () => {
        let seen: Record<string, any> | undefined;
        const registry = new CommandRegistry();
        registry.register({
            name: 'config',
            description: 'Config',
            options: [{ long: '--dry-run', description: 'Boolean' }],
            subcommands: [
                {
                    name: 'server',
                    description: 'Server',
                    options: [{ long: '--dry-run', description: 'Boolean' }],
                    action: async (options: Record<string, any>) => {
                        seen = options;
                        return 0;
                    },
                },
            ],
        });

        const run = await runCli(registry.getCommandTree(), registry.getRootOptions(), [
            'config',
            '--dry-run',
            'server',
        ]);

        expect(run.exitCode).toBe(0);
        expect(seen?.dryRun).toBe(true);
    });
});

describe('Shared root options with sub-options', () => {
    it('registers a root sub-option exactly once', async () => {
        const registry = new CommandRegistry();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/sub',
                rootOptions: [
                    {
                        long: '--auth <mode>',
                        description: 'Auth mode',
                        required: true,
                        subOptions: [{ long: '--auth-token <t>', description: 'Token', required: true }],
                    },
                ],
            }),
        );

        // The parent still carries its sub-option, so the host expands it once.
        expect(registry.getRootOptions().map(entry => entry.option.long)).toEqual(['--auth <mode>']);

        const help = await runCli(registry.getCommandTree(), registry.getRootOptions(), ['--help']);
        const authTokenLines = help.stdout.split('\n').filter(line => line.includes('--auth-token'));
        expect(authTokenLines).toHaveLength(1);
    });

    it('still detects a collision on a root sub-option', () => {
        const registry = new CommandRegistry();
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
            }),
        );

        const rival = defineCliPlugin({
            id: '@b/second',
            rootOptions: [{ long: '--shared <v>', description: 'Mine', required: true }],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(/already registered by @a\/first/);
    });
});

describe('Reserved short flags', () => {
    it('rejects a shared option using the short version flag', () => {
        const registry = registryWithCore();
        const plugin = defineCliPlugin({
            id: '@example/greedy',
            rootOptions: [{ short: '-V', long: '--verbose', description: 'Verbose' }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/"-V", which is reserved by the CLI/);
    });

    it('detects a collision on the short flag alone', () => {
        const registry = registryWithCore();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/first',
                rootOptions: [{ short: '-t', long: '--token <t>', description: 'Token', required: true }],
            }),
        );

        const rival = defineCliPlugin({
            id: '@b/second',
            rootOptions: [{ short: '-t', long: '--target <t>', description: 'Target', required: true }],
        });

        expect(() => registry.applyPlugin(rival)).toThrow(/already registered by @a\/first/);
    });
});

describe('Command extensions: runnable parent commands', () => {
    /**
     * The shape the hosted Cloud CLI registers: `deploy` runs an action of its
     * own and also parents `plan`.
     */
    function deployCommand(): CliCommandDefinition {
        return {
            name: 'deploy',
            description: 'Deploy the application',
            options: [{ long: '--env <name>', description: 'Target environment', required: true }],
            action: async () => {
                trace.push('core:deploy');
                return 0;
            },
            subcommands: [
                {
                    name: 'plan',
                    description: 'Show what a deploy would change',
                    action: async () => {
                        trace.push('core:plan');
                        return 0;
                    },
                },
            ],
        };
    }

    function registryWithDeploy(): CommandRegistry {
        const registry = registryWithCore();
        registry.register(deployCommand());
        return registry;
    }

    it('decorates the action of a command that also has subcommands', async () => {
        const registry = registryWithDeploy();
        registry.applyPlugin(
            defineCliPlugin({
                id: CREDENTIALS_ID,
                extendCommands: [
                    {
                        command: 'deploy',
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('credentials:before');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        await runCli(registry.getCommandTree(), registry.getRootOptions(), ['deploy']);

        expect(trace).toEqual(['credentials:before', 'core:deploy']);
    });

    it('leaves the subcommands of a decorated command in place', async () => {
        const registry = registryWithDeploy();
        registry.applyPlugin(
            defineCliPlugin({
                id: CREDENTIALS_ID,
                extendCommands: [
                    {
                        command: 'deploy',
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('credentials:before');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        await runCli(registry.getCommandTree(), registry.getRootOptions(), ['deploy', 'plan']);

        // The decorator wraps the parent action only, so running a subcommand
        // does not go through it.
        expect(trace).toEqual(['core:plan']);
    });

    it('shows a decorator that the command it wraps has subcommands', () => {
        const registry = registryWithDeploy();
        let seen: string[] | undefined;
        let leafSeen: unknown = 'unset';
        registry.applyPlugin(
            defineCliPlugin({
                id: CREDENTIALS_ID,
                extendCommands: [
                    {
                        command: 'deploy',
                        decorate: ({ command, next }) => {
                            seen = command.subcommands?.map(node => node.name);
                            return next;
                        },
                    },
                    {
                        command: 'dev',
                        decorate: ({ command, next }) => {
                            leafSeen = command.subcommands;
                            return next;
                        },
                    },
                ],
            }),
        );

        expect(seen).toEqual(['plan']);
        // A command with no subcommands is distinguishable from one that has them.
        expect(leafSeen).toBeUndefined();
    });

    it('does not let a decorator reach the registered subcommands', () => {
        const registry = registryWithDeploy();
        let received: Readonly<CliCommandDefinition> | undefined;
        registry.applyPlugin(
            defineCliPlugin({
                id: CREDENTIALS_ID,
                extendCommands: [
                    {
                        command: 'deploy',
                        decorate: ({ command, next }) => {
                            received = command;
                            return next;
                        },
                    },
                ],
            }),
        );

        const child = received?.subcommands?.[0] as CliCommandDefinition;
        expect(() => {
            child.description = 'hijacked';
        }).toThrow();
        expect(() => {
            (received?.subcommands as CliCommandNode[]).push({
                name: 'extra',
                description: 'Extra',
                action: async () => 0,
            });
        }).toThrow();

        const registered = registry.get('deploy') as CliCommandDefinition;
        expect(registered.subcommands?.map(node => node.name)).toEqual(['plan']);
        expect(registered.subcommands?.[0].description).toBe('Show what a deploy would change');
    });

    it('still rejects decorating a command group, which has no action', () => {
        const registry = registryWithDeploy();
        const plugin = defineCliPlugin({
            id: '@example/group',
            extendCommands: [{ command: 'config', decorate: ({ next }) => next }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/is a command group and has no action/);
    });

    it('extends a command nested under a runnable parent', async () => {
        const registry = registryWithDeploy();
        registry.applyPlugin(
            defineCliPlugin({
                id: CREDENTIALS_ID,
                extendCommands: [
                    {
                        command: ['deploy', 'plan'],
                        description: 'Show what a deploy would change, in detail',
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                trace.push('credentials:plan');
                                return next(...args);
                            },
                    },
                ],
            }),
        );

        await runCli(registry.getCommandTree(), registry.getRootOptions(), ['deploy', 'plan']);

        expect(trace).toEqual(['credentials:plan', 'core:plan']);
    });

    it('shares an option added to a runnable parent with its subcommands', async () => {
        const registry = registryWithDeploy();
        let inherited: Record<string, any> | undefined;
        registry.applyPlugin(
            defineCliPlugin({
                id: CREDENTIALS_ID,
                extendCommands: [
                    {
                        command: ['deploy', 'plan'],
                        decorate:
                            ({ next }) =>
                            async (...args: any[]) => {
                                inherited = readCommandContext(args).inheritedOptions;
                                return next(...args);
                            },
                    },
                    {
                        command: 'deploy',
                        options: [{ long: '--dry-run', description: 'Do not apply anything' }],
                    },
                ],
            }),
        );

        await runCli(registry.getCommandTree(), registry.getRootOptions(), ['deploy', 'plan', '--dry-run']);

        expect(inherited).toEqual({ dryRun: true });

        const help = await runCli(registry.getCommandTree(), registry.getRootOptions(), [
            'deploy',
            'plan',
            '--help',
        ]);
        expect(help.stdout).toContain('Global Options:');
        expect(help.stdout).toMatch(/^\s+--dry-run /m);
    });

    it('rejects an option added to a runnable parent that is already shared at the root', () => {
        const registry = registryWithDeploy();
        registry.applyPlugin(
            defineCliPlugin({
                id: '@a/root',
                rootOptions: [{ long: '--dry-run', description: 'Do not apply anything' }],
            }),
        );

        const plugin = defineCliPlugin({
            id: '@b/parent',
            extendCommands: [
                {
                    command: 'deploy',
                    options: [{ long: '--dry-run', description: 'Do not apply anything' }],
                },
            ],
        });

        // Named as a command rather than a command group: it runs an action of
        // its own, but shares its options in the same way.
        expect(() => registry.applyPlugin(plugin)).toThrow(
            /added to the command "vendure deploy" is already a shared option[\s\S]+cannot be shared at two levels/,
        );
    });

    it('rejects a shared root option that a runnable parent already shares', () => {
        const registry = registryWithDeploy();
        const plugin = defineCliPlugin({
            id: '@b/root',
            rootOptions: [{ long: '--env <name>', description: 'Environment', required: true }],
        });

        expect(() => registry.applyPlugin(plugin)).toThrow(/already shared by the command "vendure deploy"/);
    });
});
