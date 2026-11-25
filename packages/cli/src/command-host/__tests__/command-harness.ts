import type { CommandDefinition, SpawnOptions, SpawnResult } from '@vendure/common/lib/command';

import type { HostEnvironment, Prompter } from '../host.js';
import { runInTestHost, TestCommandResult } from '../test-command.js';

export type HarnessRun = TestCommandResult;

/**
 * Runs a command through the host the way the CLI does, and fails when `run` or `plan` writes to
 * stdout or stderr. It runs on `testCommand`'s host, the one plugins use, with one difference:
 * without `requireCredential` the host has no credential check, so a `requires.auth` command is an
 * internal error here, where `testCommand` gives the `token` need. Specs pass the check they test.
 */
export function runCommandInHarness(
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
    const { requireCredential, ...testOptions } = options;
    return runInTestHost(def, input, testOptions, requireCredential ? { requireCredential } : {});
}
