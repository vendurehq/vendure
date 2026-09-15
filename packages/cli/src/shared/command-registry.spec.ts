import { beforeEach, describe, expect, it } from 'vitest';

import { createColors } from 'picocolors';

import { sectionAfter } from './__tests__/help-sections';
import { runCli } from './__tests__/run-cli';
import {
    CliCommandDefinition,
    CliCommandNode,
    CliCommandOption,
    readCommandContext,
    readCommandOptions,
} from './cli-command-definition';
import { exitCliCommand } from './cli-command-exit';
import { parseOptionFlags } from './cli-command-options';
import { styleHelpTitle } from './command-registry';
import { CommandTreeEntry, RootOptionEntry } from './command-registry-store';

interface RecordedCall {
    commandPath: string[];
    positionals: any[];
    options: Record<string, any>;
    inheritedOptions: Record<string, any>;
}

const calls: RecordedCall[] = [];

beforeEach(() => {
    calls.length = 0;
});

/**
 * A command that records what the host handed to it, with or without
 * subcommands of its own. The context is always the final argument, after
 * Commander's positionals, options and Command.
 */
function recordingCommand(
    name: string,
    description: string,
    extra: Partial<CliCommandDefinition> = {},
): CliCommandDefinition {
    return {
        name,
        description,
        ...extra,
        action: async (...args: any[]) => {
            // Uses the exported helpers, so a break in them fails these tests.
            const context = readCommandContext(args);
            calls.push({
                commandPath: context.commandPath,
                positionals: args.slice(0, args.length - 3),
                options: readCommandOptions(args),
                inheritedOptions: context.inheritedOptions,
            });
            return 0;
        },
    };
}

const rootOptions: CliCommandOption[] = [
    { long: '--token <token>', description: 'API token', required: true },
    { long: '--project <slug>', description: 'Target project', required: true },
    { long: '--environment <name>', description: 'Target environment', required: true },
    { long: '--json', description: 'Output JSON' },
];

function cloudCommands(): CliCommandNode[] {
    return [
        {
            name: 'project',
            description: 'Manage projects',
            subcommands: [recordingCommand('list', 'List projects')],
        },
        {
            name: 'config',
            description: 'Manage configuration',
            options: [{ long: '--profile <name>', description: 'Configuration profile', required: true }],
            subcommands: [
                {
                    name: 'server',
                    description: 'Server configuration',
                    subcommands: [
                        recordingCommand('set', 'Set a server config value', {
                            arguments: [
                                { name: 'key', description: 'Key', required: true },
                                { name: 'value', description: 'Value', required: true },
                            ],
                        }),
                    ],
                },
            ],
        },
        {
            name: 'backup',
            description: 'Manage backups',
            subcommands: [
                {
                    name: 'db',
                    description: 'Database backups',
                    subcommands: [recordingCommand('list', 'List database backups')],
                },
            ],
        },
        {
            name: 'restore',
            description: 'Restore from a backup',
            subcommands: [
                recordingCommand('db', 'Restore the database', {
                    arguments: [{ name: 'backupId', description: 'Backup id', required: true }],
                }),
            ],
        },
    ];
}

describe('registerCommands() with nested commands', () => {
    it('passes opaque plugin extension values to command actions', async () => {
        const extension = { requiresSession: true };
        let received: unknown;
        const command: CliCommandDefinition = {
            name: 'inspect',
            description: 'Inspect extensions',
            action: async (...args: any[]) => {
                received = readCommandContext(args).getPluginExtensions('example')[0];
                return 0;
            },
        };

        await runCli([command], [], ['inspect'], name =>
            name === 'example' ? [{ pluginId: '@example/plugin', extension }] : [],
        );

        expect(received).toEqual({ pluginId: '@example/plugin', extension });
        expect((received as { extension: unknown }).extension).toBe(extension);
    });

    it('executes a two-level command', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['project', 'list']);

        expect(result.exitCode).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].commandPath).toEqual(['project', 'list']);
    });

    it('executes a three-level command with positional arguments', async () => {
        const result = await runCli(cloudCommands(), rootOptions, [
            'config',
            'server',
            'set',
            'apiPort',
            '3001',
        ]);

        expect(result.exitCode).toBe(0);
        expect(calls[0].commandPath).toEqual(['config', 'server', 'set']);
        expect(calls[0].positionals).toEqual(['apiPort', '3001']);
    });

    it('executes a three-level command with no arguments', async () => {
        await runCli(cloudCommands(), rootOptions, ['backup', 'db', 'list']);

        expect(calls[0].commandPath).toEqual(['backup', 'db', 'list']);
        expect(calls[0].positionals).toEqual([]);
    });

    it('executes a two-level command with an argument', async () => {
        await runCli(cloudCommands(), rootOptions, ['restore', 'db', 'backup-42']);

        expect(calls[0].commandPath).toEqual(['restore', 'db']);
        expect(calls[0].positionals).toEqual(['backup-42']);
    });

    it('passes shared root options given before the command path', async () => {
        await runCli(cloudCommands(), rootOptions, [
            '--token',
            'tok',
            '--project',
            'my-project',
            '--environment',
            'staging',
            '--json',
            'project',
            'list',
        ]);

        expect(calls[0].inheritedOptions).toEqual({
            token: 'tok',
            project: 'my-project',
            environment: 'staging',
            json: true,
        });
    });

    it('passes shared root options given after the command path', async () => {
        await runCli(cloudCommands(), rootOptions, [
            'backup',
            'db',
            'list',
            '--token',
            'tok',
            '--project',
            'my-project',
            '--environment',
            'prod',
            '--json',
        ]);

        expect(calls[0].inheritedOptions).toEqual({
            token: 'tok',
            project: 'my-project',
            environment: 'prod',
            json: true,
        });
    });

    it('takes the last value when a shared option is repeated', async () => {
        await runCli(cloudCommands(), rootOptions, [
            '--token',
            'first',
            'project',
            'list',
            '--token',
            'last',
        ]);

        expect(calls[0].inheritedOptions.token).toBe('last');
    });

    it('omits shared options that were neither supplied nor defaulted', async () => {
        await runCli(cloudCommands(), rootOptions, ['project', 'list', '--token', 'tok']);

        expect(calls[0].inheritedOptions).toEqual({ token: 'tok' });
    });

    it('includes the default value of a shared option that was not supplied', async () => {
        await runCli(
            cloudCommands(),
            [{ long: '--environment <name>', description: 'Environment', defaultValue: 'production' }],
            ['project', 'list'],
        );

        expect(calls[0].inheritedOptions).toEqual({ environment: 'production' });
    });

    it('inherits a group option only within that group', async () => {
        await runCli(cloudCommands(), rootOptions, [
            'config',
            'server',
            'set',
            'apiPort',
            '3001',
            '--profile',
            'ci',
        ]);
        expect(calls[0].inheritedOptions.profile).toBe('ci');

        const outside = await runCli(cloudCommands(), rootOptions, ['project', 'list', '--profile', 'ci']);
        expect(outside.exitCode).toBe(1);
        expect(outside.stderr).toContain("unknown option '--profile'");
    });

    it('separates a command own options from the shared ones', async () => {
        const commands: CliCommandNode[] = [
            {
                name: 'project',
                description: 'Manage projects',
                subcommands: [
                    recordingCommand('list', 'List projects', {
                        options: [{ long: '--limit <n>', description: 'Maximum results', required: true }],
                    }),
                ],
            },
        ];
        await runCli(commands, rootOptions, ['project', 'list', '--limit', '5', '--token', 'tok']);

        expect(calls[0].options).toEqual({ limit: '5' });
        expect(calls[0].inheritedOptions).toEqual({ token: 'tok' });
    });

    it('gives a command its own value when it declares the same flag as a shared option', async () => {
        const commands: CliCommandNode[] = [
            recordingCommand('plugins', 'Manage CLI plugins', {
                options: [{ long: '--json', description: 'Output JSON' }],
            }),
        ];
        await runCli(commands, rootOptions, ['plugins', '--json']);

        expect(calls[0].options.json).toBe(true);
        expect(calls[0].inheritedOptions.json).toBe(true);
    });

    it('shares one value between a shared option and a command option of the same name', async () => {
        // The flag written before the command is consumed by the shared option,
        // so only the host copying it onto the command keeps both in step.
        const commands: CliCommandNode[] = [
            recordingCommand('plugins', 'Manage CLI plugins', {
                options: [{ long: '--json', description: 'Output JSON' }],
            }),
        ];
        await runCli(commands, rootOptions, ['--json', 'plugins']);

        expect(calls[0].options.json).toBe(true);
        expect(calls[0].inheritedOptions.json).toBe(true);
    });
});

/**
 * The two shapes the hosted Cloud CLI needs: `deploy`, which runs an action of
 * its own and parents `plan` and `teardown`; and `backup db`, which does the
 * same one level down, inside the pure `backup` group.
 */
function runnableParentCommands(): CliCommandNode[] {
    return [
        recordingCommand('deploy', 'Deploy the application', {
            options: [{ long: '--env <name>', description: 'Target environment', required: true }],
            subcommands: [
                recordingCommand('plan', 'Show what a deploy would change'),
                recordingCommand('teardown', 'Tear the deployment down'),
            ],
        }),
        {
            name: 'backup',
            description: 'Manage backups',
            subcommands: [
                recordingCommand('db', 'Back the database up', {
                    subcommands: [
                        recordingCommand('list', 'List database backups'),
                        recordingCommand('status', 'Show the status of a backup'),
                    ],
                }),
            ],
        },
    ];
}

describe('registerCommands() with runnable parent commands', () => {
    it('runs the parent action when no subcommand is given', async () => {
        const result = await runCli(runnableParentCommands(), rootOptions, ['deploy']);

        expect(result.exitCode).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].commandPath).toEqual(['deploy']);
    });

    it('runs the subcommand rather than the parent action', async () => {
        await runCli(runnableParentCommands(), rootOptions, ['deploy', 'plan']);
        await runCli(runnableParentCommands(), rootOptions, ['deploy', 'teardown']);

        expect(calls.map(call => call.commandPath)).toEqual([
            ['deploy', 'plan'],
            ['deploy', 'teardown'],
        ]);
    });

    it('runs a runnable parent nested inside a group, and its subcommands', async () => {
        await runCli(runnableParentCommands(), rootOptions, ['backup', 'db']);
        await runCli(runnableParentCommands(), rootOptions, ['backup', 'db', 'list']);
        await runCli(runnableParentCommands(), rootOptions, ['backup', 'db', 'status']);

        expect(calls.map(call => call.commandPath)).toEqual([
            ['backup', 'db'],
            ['backup', 'db', 'list'],
            ['backup', 'db', 'status'],
        ]);
    });

    it('passes a runnable parent its own options', async () => {
        await runCli(runnableParentCommands(), rootOptions, ['deploy', '--env', 'staging']);

        expect(calls[0].options).toEqual({ env: 'staging' });
    });

    it('shares a runnable parent option with its subcommands, given before the subcommand', async () => {
        await runCli(runnableParentCommands(), rootOptions, ['deploy', '--env', 'staging', 'plan']);

        expect(calls[0].commandPath).toEqual(['deploy', 'plan']);
        expect(calls[0].inheritedOptions.env).toBe('staging');
        // The parent option is shared, not one of the subcommand's own.
        expect(calls[0].options).toEqual({});
    });

    it('shares a runnable parent option with its subcommands, given after the subcommand', async () => {
        await runCli(runnableParentCommands(), rootOptions, ['deploy', 'plan', '--env', 'staging']);

        expect(calls[0].inheritedOptions.env).toBe('staging');
    });

    it('shares root options with a runnable parent and with its subcommands', async () => {
        await runCli(runnableParentCommands(), rootOptions, ['deploy', '--token', 'tok']);
        await runCli(runnableParentCommands(), rootOptions, ['backup', 'db', 'list', '--token', 'tok']);

        expect(calls[0].inheritedOptions).toEqual({ token: 'tok' });
        expect(calls[1].inheritedOptions).toEqual({ token: 'tok' });
    });

    it('does not offer a runnable parent option outside its subtree', async () => {
        const result = await runCli(runnableParentCommands(), rootOptions, [
            'backup',
            'db',
            'list',
            '--env',
            'staging',
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown option '--env'");
    });

    it('reports a word that names no subcommand rather than running the parent', async () => {
        const result = await runCli(runnableParentCommands(), rootOptions, ['deploy', 'plann']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown command 'plann'");
        expect(calls).toHaveLength(0);
    });

    it('reports it the way a group does, through Commander and with a suggestion', async () => {
        // The point of the shape is that it behaves like a group, so the two
        // have to agree on the message, the channel and the exit code.
        const parent = await runCli(runnableParentCommands(), rootOptions, ['deploy', 'plann']);
        const group = await runCli(runnableParentCommands(), rootOptions, ['backup', 'dbb']);

        expect(parent.stderr).toContain('(Did you mean plan?)');
        expect(group.stderr).toContain('(Did you mean db?)');
        expect(parent.exitCode).toBe(group.exitCode);
        // Written through the output Commander was configured with, not
        // straight to the process, which is what `runCli` records separately.
        expect(parent.commanderStderr).toContain("unknown command 'plann'");
        expect(parent.processStderr).toBe('');
    });

    it('keeps the help subcommand that Commander omits once a command has an action', async () => {
        const result = await runCli(runnableParentCommands(), rootOptions, ['deploy', 'help']);

        expect(calls).toHaveLength(0);
        expect(result.stdout).toMatch(/^\s+plan\s+Show what a deploy would change$/m);
    });

    it('does not list a second help when the plugin declares its own', async () => {
        const commands: CliCommandNode[] = [
            recordingCommand('deploy', 'Deploy the application', {
                subcommands: [
                    recordingCommand('plan', 'Show what a deploy would change'),
                    recordingCommand('help', 'Explain how deploying works'),
                ],
            }),
        ];

        const result = await runCli(commands, [], ['deploy', '--help']);

        expect(result.stdout).toMatch(/^\s+help\s+Explain how deploying works$/m);
        expect(result.stdout).not.toContain('help [command]');
    });

    it('runs a pure group nested under a runnable parent', async () => {
        const commands: CliCommandNode[] = [
            recordingCommand('deploy', 'Deploy the application', {
                subcommands: [
                    {
                        name: 'config',
                        description: 'Deployment configuration',
                        subcommands: [recordingCommand('show', 'Show the configuration')],
                    },
                ],
            }),
        ];

        await runCli(commands, [], ['deploy']);
        await runCli(commands, [], ['deploy', 'config', 'show']);
        const group = await runCli(commands, [], ['deploy', 'config']);

        expect(calls.map(call => call.commandPath)).toEqual([['deploy'], ['deploy', 'config', 'show']]);
        expect(group.exitCode).toBe(1);
        expect(group.stderr).toContain('Usage: vendure deploy config');
    });

    it('uses the numeric result of a parent action as the exit code', async () => {
        const commands: CliCommandNode[] = [
            {
                name: 'deploy',
                description: 'Deploy the application',
                action: async () => 3,
                subcommands: [recordingCommand('plan', 'Show what a deploy would change')],
            },
        ];
        const result = await runCli(commands, [], ['deploy']);

        expect(result.exitCode).toBe(3);
    });

    it("lists a runnable parent's subcommands and options in its help", async () => {
        const result = await runCli(runnableParentCommands(), rootOptions, ['deploy', '--help']);

        expect(result.stdout).toContain('Usage: vendure deploy [options] [command]');
        expect(result.stdout).toMatch(/^\s+plan\s+Show what a deploy would change$/m);
        expect(result.stdout).toMatch(/^\s+teardown\s+Tear the deployment down$/m);
        expect(result.stdout).toMatch(/^\s+--env /m);
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toMatch(/^\s+--token /m);
    });

    it('lists the subcommands of a runnable parent nested inside a group', async () => {
        const result = await runCli(runnableParentCommands(), rootOptions, ['backup', 'db', '--help']);

        expect(result.stdout).toContain('Usage: vendure backup db');
        expect(result.stdout).toMatch(/^\s+list\s+List database backups$/m);
        expect(result.stdout).toMatch(/^\s+status\s+Show the status of a backup$/m);
    });
});

describe('registerCommands() help output', () => {
    it('lists top-level commands and shared options in root help', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['--help']);

        expect(result.stdout).toMatch(/^\s+--token /m);
        expect(result.stdout).toMatch(/^\s+--json /m);
        // Anchored on the command list: the bare words appear in descriptions
        // and option names too, so `toContain` would pass without the commands.
        expect(result.stdout).toMatch(/^\s+project\s+Manage projects$/m);
        expect(result.stdout).toMatch(/^\s+config \[options\]\s+Manage configuration$/m);
        expect(result.stdout).toMatch(/^\s+backup\s+Manage backups$/m);
        expect(result.stdout).toMatch(/^\s+restore\s+Restore from a backup$/m);
    });

    it('lists subcommands and inherited options in parent help', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config', '--help']);

        expect(result.stdout).toContain('Usage: vendure config');
        expect(result.stdout).toMatch(/^\s+server\s+Server configuration$/m);
        expect(result.stdout).toMatch(/^\s+--profile /m);
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toMatch(/^\s+--token /m);
    });

    it('lists the options valid at every level in leaf help', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config', 'server', 'set', '--help']);

        expect(result.stdout).toContain('vendure config server set [options] <key> <value>');
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toMatch(/^\s+--profile /m);
        expect(result.stdout).toMatch(/^\s+--token /m);
    });

    it('prints help and fails when a group is run without a subcommand', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Usage: vendure config');
        expect(result.stderr).toMatch(/^\s+server\s+Server configuration$/m);
    });
});

/**
 * A built-in alongside the plugin commands, so a test can tell the grouped
 * section from the ungrouped one rather than just counting headings.
 */
function mixedCommands(): CliCommandNode[] {
    return [recordingCommand('dev', 'Run Vendure in development mode'), ...cloudCommands()];
}

/** Tags the named commands with a source; the rest stay built-ins. */
function withCommandSources(commands: CliCommandNode[], sources: Record<string, string>): CommandTreeEntry[] {
    return commands.map(node => ({ node, source: sources[node.name] }));
}

/** Tags the named options with a source, keyed by Commander attribute name. */
function withOptionSources(options: CliCommandOption[], sources: Record<string, string>): RootOptionEntry[] {
    return options.map(option => ({ option, source: sources[parseOptionFlags(option).attributeName] }));
}

describe('registerCommands() help grouping', () => {
    it('lists a plugin command under a heading naming its package', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), { project: '@vendure/cloud', config: '@vendure/cloud' }),
            rootOptions,
            ['--help'],
        );

        expect(result.stdout).toContain('Commands from @vendure/cloud:');
        expect(result.stdout).toMatch(/^\s+project\s+Manage projects$/m);
        expect(result.stdout).toMatch(/^\s+config \[options\]\s+Manage configuration$/m);
    });

    it('leaves commands with no source under the default heading', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), { project: '@vendure/cloud' }),
            rootOptions,
            ['--help'],
        );

        const defaultSection = sectionAfter(result.stdout, 'Commands:');
        expect(defaultSection).toMatch(/^\s+dev\s+Run Vendure in development mode$/m);
        expect(defaultSection).toMatch(/^\s+backup\s+Manage backups$/m);
        expect(defaultSection).not.toContain('Manage projects');
    });

    it('puts every command from one package in a single section', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), {
                project: '@vendure/cloud',
                config: '@vendure/cloud',
                backup: '@vendure/cloud',
            }),
            rootOptions,
            ['--help'],
        );

        const headings = result.stdout.match(/^Commands from @vendure\/cloud:$/gm) ?? [];
        expect(headings).toHaveLength(1);

        const pluginSection = sectionAfter(result.stdout, 'Commands from @vendure/cloud:');
        expect(pluginSection).toMatch(/^\s+project\s+Manage projects$/m);
        expect(pluginSection).toMatch(/^\s+backup\s+Manage backups$/m);
    });

    it('gives two packages a section each', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), {
                project: '@vendure/cloud',
                backup: 'vendure-plugin-backups',
            }),
            rootOptions,
            ['--help'],
        );

        expect(sectionAfter(result.stdout, 'Commands from @vendure/cloud:')).toMatch(
            /^\s+project\s+Manage projects$/m,
        );
        expect(sectionAfter(result.stdout, 'Commands from vendure-plugin-backups:')).toMatch(
            /^\s+backup\s+Manage backups$/m,
        );
    });

    it('lists the built-ins first', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), { project: '@vendure/cloud' }),
            rootOptions,
            ['--help'],
        );

        expect(result.stdout.indexOf('\nCommands:')).toBeLessThan(
            result.stdout.indexOf('Commands from @vendure/cloud:'),
        );
    });

    it('lists a shared option under a heading naming its package', async () => {
        const result = await runCli(
            mixedCommands(),
            withOptionSources(rootOptions, { token: '@vendure/cloud', json: '@vendure/cloud' }),
            ['--help'],
        );

        const pluginSection = sectionAfter(result.stdout, 'Options from @vendure/cloud:');
        expect(pluginSection).toMatch(/^\s+--token /m);
        expect(pluginSection).toMatch(/^\s+--json /m);
    });

    it("leaves the CLI's own options under the default heading", async () => {
        const result = await runCli(
            mixedCommands(),
            withOptionSources(rootOptions, { token: '@vendure/cloud' }),
            ['--help'],
        );

        const defaultSection = sectionAfter(result.stdout, 'Options:');
        expect(defaultSection).toMatch(/^\s+-h, --help/m);
        expect(defaultSection).not.toContain('--token');
        // Not every shared option came from the plugin, so the rest stay put.
        expect(defaultSection).toMatch(/^\s+--project /m);
    });

    it('groups a sub-option with its parent', async () => {
        const withSubOption: CliCommandOption[] = [
            {
                long: '--token <token>',
                description: 'API token',
                subOptions: [{ long: '--token-file <path>', description: 'Read the token from a file' }],
            },
        ];

        const result = await runCli(
            mixedCommands(),
            withOptionSources(withSubOption, { token: '@vendure/cloud' }),
            ['--help'],
        );

        // The sub-option is listed indented under its parent, so splitting them
        // into different sections would put the indented line under nothing.
        const pluginSection = sectionAfter(result.stdout, 'Options from @vendure/cloud:');
        expect(pluginSection).toMatch(/^\s+--token /m);
        expect(pluginSection).toMatch(/^\s+--token-file /m);
    });

    it('groups no options when no option sources are given', async () => {
        const result = await runCli(mixedCommands(), rootOptions, ['--help']);

        expect(result.stdout).not.toContain('Options from');
        expect(sectionAfter(result.stdout, 'Options:')).toMatch(/^\s+--token /m);
    });

    it('groups nothing when no sources are given', async () => {
        const result = await runCli(mixedCommands(), rootOptions, ['--help']);

        expect(result.stdout).not.toContain('Commands from');
        expect(sectionAfter(result.stdout, 'Commands:')).toMatch(/^\s+project\s+Manage projects$/m);
    });

    it('does not group a subcommand of a plugin command', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), { project: '@vendure/cloud', list: '@vendure/cloud' }),
            rootOptions,
            ['project', '--help'],
        );

        // `list` is a subcommand of `project`, so the source map's top-level
        // `list` entry must not reach it: its parent's help already says which
        // package it came from.
        expect(result.stdout).not.toContain('Commands from');
        expect(result.stdout).toMatch(/^\s+list\s+List projects$/m);
    });
});

describe('styleHelpTitle()', () => {
    const BOLD_ON = '\u001b[1m';
    const BOLD_OFF = '\u001b[22m';
    const CYAN_ON = '\u001b[36m';
    // picocolors emits nothing when stdout is not a terminal, which it is not
    // under vitest, so colour has to be forced on to see the escape codes.
    const colors = createColors(true);
    const style = (title: string) => styleHelpTitle(title, colors);

    it("bolds the CLI's own headings", () => {
        expect(style('Commands:')).toBe(`${BOLD_ON}Commands:${BOLD_OFF}`);
        expect(style('Options:')).toBe(`${BOLD_ON}Options:${BOLD_OFF}`);
    });

    it('tints the package name inside a plugin heading', () => {
        const styled = style('Commands from @vendure/cloud:');

        expect(styled).toContain(`${CYAN_ON}@vendure/cloud`);
        // The label and the colon are outside the cyan run, so only the
        // package name is coloured.
        expect(styled).not.toContain(`${CYAN_ON}Commands from`);
    });

    it('keeps one weight across the whole plugin heading', () => {
        const styled = style('Options from @vendure/cloud:');

        expect(styled.startsWith(BOLD_ON)).toBe(true);
        expect(styled.endsWith(BOLD_OFF)).toBe(true);
        // One bold span, not one per fragment: a `bold off` in the middle
        // leaves the rest of the heading at normal weight.
        expect(styled.split(BOLD_OFF)).toHaveLength(2);
        expect(styled.split(BOLD_ON)).toHaveLength(2);
    });

    // styleHelpTitle parses a string the heading builders produced, so a
    // change to either format has to keep the other working.
    it('recognises the headings the registry actually builds', async () => {
        const result = await runCli(
            withCommandSources(mixedCommands(), { project: '@vendure/cloud' }),
            withOptionSources(rootOptions, { token: '@vendure/cloud' }),
            ['--help'],
        );

        for (const heading of ['Commands from @vendure/cloud:', 'Options from @vendure/cloud:']) {
            expect(result.stdout).toContain(heading);
            expect(style(heading)).toContain(CYAN_ON);
        }
    });

    it('leaves a heading it does not recognise merely bold', () => {
        expect(style('Global Options:')).toBe(`${BOLD_ON}Global Options:${BOLD_OFF}`);
        expect(style('Arguments:')).toBe(`${BOLD_ON}Arguments:${BOLD_OFF}`);
    });
});

describe('registerCommands() error handling', () => {
    it('fails on an unknown subcommand', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['project', 'destroy']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown command 'destroy'");
        expect(calls).toHaveLength(0);
    });

    it('fails on an unknown option', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['project', 'list', '--nope']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown option '--nope'");
        expect(calls).toHaveLength(0);
    });

    it('fails on a missing required argument', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config', 'server', 'set', 'apiPort']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("missing required argument 'value'");
    });

    it('uses the numeric result of an action as the exit code', async () => {
        const commands: CliCommandNode[] = [{ name: 'fail', description: 'Fails', action: async () => 3 }];
        const result = await runCli(commands, [], ['fail']);

        expect(result.exitCode).toBe(3);
    });

    it('reports a thrown error and exits 1', async () => {
        const commands: CliCommandNode[] = [
            {
                name: 'boom',
                description: 'Throws',
                action: async () => {
                    throw new Error('something broke');
                },
            },
        ];
        const result = await runCli(commands, [], ['boom']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('something broke');
    });

    it('honours an exit requested by exitCliCommand', async () => {
        const commands: CliCommandNode[] = [
            {
                name: 'stop',
                description: 'Stops early',
                action: async () => exitCliCommand(2),
            },
        ];
        const result = await runCli(commands, [], ['stop']);

        expect(result.exitCode).toBe(2);
    });
});
