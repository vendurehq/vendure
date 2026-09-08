import { Command, CommanderError } from 'commander';
import { vi } from 'vitest';

import { CliCommandNode, CliCommandOption } from '../cli-command-definition';
import { CliPluginExtensionAccessor } from '../cli-plugin-extension';
import { registerCommands } from '../command-registry';

/**
 * Thrown in place of `process.exit` so a test can observe the exit code the
 * CLI host asked for.
 */
class ExitSignal extends Error {
    constructor(readonly code: number) {
        super(`exit ${code}`);
    }
}

export interface CliRun {
    exitCode?: number;
    /** Commander's own output plus anything the action wrote to stdout. */
    stdout: string;
    /** Commander's own errors plus anything the host or action wrote to stderr. */
    stderr: string;
    /**
     * Only what Commander wrote through the output it was configured with. Kept
     * apart from {@link processStderr} so a test can tell an error reported
     * through Commander from one written straight to the process, which look
     * identical in {@link stderr}.
     */
    commanderStderr: string;
    /** Only what was written straight to `process.stderr`, bypassing Commander. */
    processStderr: string;
}

/**
 * Registers a command tree on a fresh Commander program and parses `argv`,
 * capturing everything the host would have written or exited with.
 */
export async function runCli(
    commands: CliCommandNode[],
    sharedOptions: CliCommandOption[],
    argv: string[],
    getPluginExtensions?: CliPluginExtensionAccessor,
): Promise<CliRun> {
    let stdout = '';
    let commanderStderr = '';
    let processStderr = '';

    const program = new Command();
    program.name('vendure').exitOverride();
    // Mirrors the host: set before any subcommand is created.
    program.configureHelp({ showGlobalOptions: true });
    program.configureOutput({
        writeOut: str => {
            stdout += str;
        },
        writeErr: str => {
            commanderStderr += str;
        },
    });
    registerCommands(program, commands, sharedOptions, getPluginExtensions);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new ExitSignal(code ?? 0);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(str => {
        processStderr += String(str);
        return true;
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(str => {
        stdout += String(str);
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
        stdoutSpy.mockRestore();
    }

    return {
        exitCode,
        stdout,
        stderr: commanderStderr + processStderr,
        commanderStderr,
        processStderr,
    };
}
