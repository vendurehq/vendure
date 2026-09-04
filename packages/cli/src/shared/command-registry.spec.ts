import { Command, CommanderError } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CliCommandContext,
    CliCommandDefinition,
    CliCommandNode,
    CliCommandOption,
} from './cli-command-definition';
import { exitCliCommand } from './cli-command-exit';
import { registerCommands } from './command-registry';

/**
 * Thrown in place of `process.exit` so a test can observe the exit code the
 * CLI host asked for.
 */
class ExitSignal extends Error {
    constructor(readonly code: number) {
        super(`exit ${code}`);
    }
}

interface CliRun {
    exitCode?: number;
    stdout: string;
    stderr: string;
}

/**
 * Registers a command tree on a fresh Commander program and parses `argv`,
 * capturing everything the host would have written or exited with.
 */
async function runCli(
    commands: CliCommandNode[],
    sharedOptions: CliCommandOption[],
    argv: string[],
): Promise<CliRun> {
    let stdout = '';
    let stderr = '';

    const program = new Command();
    program.name('vendure').exitOverride();
    program.configureOutput({
        writeOut: str => {
            stdout += str;
        },
        writeErr: str => {
            stderr += str;
        },
    });
    registerCommands(program, commands, sharedOptions);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ExitSignal(code ?? 0);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(str => {
        stderr += String(str);
        return true;
    });

    let exitCode: number | undefined;
    try {
        await program.parseAsync(['node', 'vendure', ...argv]);
    } catch (e) {
        if (e instanceof ExitSignal) {
            exitCode = e.code;
        } else if (e instanceof CommanderError) {
            exitCode = e.exitCode;
        } else {
            throw e;
        }
    } finally {
        exitSpy.mockRestore();
        stderrSpy.mockRestore();
    }

    return { exitCode, stdout, stderr };
}

interface RecordedCall {
    commandPath: string[];
    positionals: any[];
    options: Record<string, any>;
    inheritedOptions: Record<string, any>;
}

const calls: RecordedCall[] = [];

/**
 * A leaf that records what the host handed to it. The context is always the
 * final argument, after Commander's positionals, options and Command.
 */
function recordingLeaf(
    name: string,
    description: string,
    extra: Partial<CliCommandDefinition> = {},
): CliCommandDefinition {
    return {
        name,
        description,
        ...extra,
        action: async (...args: any[]) => {
            const context = args[args.length - 1] as CliCommandContext;
            calls.push({
                commandPath: context.commandPath,
                positionals: args.slice(0, args.length - 3),
                options: args[args.length - 3],
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
            subcommands: [recordingLeaf('list', 'List projects')],
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
                        recordingLeaf('set', 'Set a server config value', {
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
                    subcommands: [recordingLeaf('list', 'List database backups')],
                },
            ],
        },
        {
            name: 'restore',
            description: 'Restore from a backup',
            subcommands: [
                recordingLeaf('db', 'Restore the database', {
                    arguments: [{ name: 'backupId', description: 'Backup id', required: true }],
                }),
            ],
        },
    ];
}

describe('registerCommands() with nested commands', () => {
    afterEach(() => {
        calls.length = 0;
    });

    it('executes a two-level command', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['project', 'list']);

        expect(result.exitCode).toBe(0);
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

    it('executes the remaining fixture commands', async () => {
        await runCli(cloudCommands(), rootOptions, ['backup', 'db', 'list']);
        await runCli(cloudCommands(), rootOptions, ['restore', 'db', 'backup-42']);

        expect(calls.map(call => call.commandPath)).toEqual([
            ['backup', 'db', 'list'],
            ['restore', 'db'],
        ]);
        expect(calls[1].positionals).toEqual(['backup-42']);
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
                    recordingLeaf('list', 'List projects', {
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
            recordingLeaf('plugins', 'Manage CLI plugins', {
                options: [{ long: '--json', description: 'Output JSON' }],
            }),
        ];
        await runCli(commands, rootOptions, ['plugins', '--json']);

        expect(calls[0].options.json).toBe(true);
        expect(calls[0].inheritedOptions.json).toBe(true);
    });
});

describe('registerCommands() help output', () => {
    it('lists top-level commands and shared options in root help', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['--help']);

        expect(result.stdout).toContain('--token');
        expect(result.stdout).toContain('--json');
        for (const name of ['project', 'config', 'backup', 'restore']) {
            expect(result.stdout).toContain(name);
        }
    });

    it('lists subcommands and inherited options in parent help', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config', '--help']);

        expect(result.stdout).toContain('vendure config');
        expect(result.stdout).toContain('server');
        expect(result.stdout).toContain('--profile');
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toContain('--token');
    });

    it('lists the options valid at every level in leaf help', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config', 'server', 'set', '--help']);

        expect(result.stdout).toContain('vendure config server set [options] <key> <value>');
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toContain('--profile');
        expect(result.stdout).toContain('--token');
    });

    it('prints help and fails when a group is run without a subcommand', async () => {
        const result = await runCli(cloudCommands(), rootOptions, ['config']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('vendure config');
        expect(result.stderr).toContain('server');
    });
});

describe('registerCommands() error handling', () => {
    afterEach(() => {
        calls.length = 0;
    });

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
