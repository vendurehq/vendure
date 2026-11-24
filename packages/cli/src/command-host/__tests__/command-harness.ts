import type { CommandDefinition, CommandEvent, SpawnOptions, SpawnResult } from '@vendure/common/lib/command';
import { vi } from 'vitest';

import { executeCommand, HostEnvironment, HostResult, Prompter } from '../host.js';

export interface HarnessRun extends HostResult {
    events: CommandEvent[];
    spawned: Array<{ command: string; args: string[] }>;
}

/**
 * Runs a command through the host the way the CLI does, and fails when `run` or `plan` writes to
 * stdout or stderr. A command reports through the context only. It does not print.
 */
export async function runCommandInHarness(
    def: CommandDefinition,
    input: Record<string, unknown>,
    options: {
        prompter?: Prompter;
        mcp?: boolean;
        projectRoot?: string | undefined;
        spawn?: (command: string, args: string[], options?: SpawnOptions) => Promise<SpawnResult>;
        signal?: AbortSignal;
        requireCredential?: HostEnvironment['requireCredential'];
        writeSecret?: HostEnvironment['writeSecret'];
    } = {},
): Promise<HarnessRun> {
    const events: CommandEvent[] = [];
    const spawned: HarnessRun['spawned'] = [];
    const printed: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
        printed.push(String(chunk));
        return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
        printed.push(String(chunk));
        return true;
    });
    const env: HostEnvironment = {
        cwd: process.cwd(),
        signal: options.signal ?? new AbortController().signal,
        mcp: options.mcp ?? false,
        prompter: options.prompter,
        ...(options.requireCredential ? { requireCredential: options.requireCredential } : {}),
        ...(options.writeSecret ? { writeSecret: options.writeSecret } : {}),
        emit: event => events.push(event),
        spawn: async (command, args, spawnOptions) => {
            spawned.push({ command, args });
            return options.spawn?.(command, args, spawnOptions) ?? { exitCode: 0, stdout: '', stderr: '' };
        },
        findProjectRoot: () => ('projectRoot' in options ? options.projectRoot : '/project'),
    };
    try {
        const result = await executeCommand(def, input, env);
        if (printed.length > 0) {
            throw new Error(`The command wrote to the console: ${printed.join('')}`);
        }
        return { ...result, events, spawned };
    } finally {
        stdout.mockRestore();
        stderr.mockRestore();
    }
}
