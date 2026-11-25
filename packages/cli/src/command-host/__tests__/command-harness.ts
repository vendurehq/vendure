import type { CommandDefinition, SpawnOptions, SpawnResult } from '@vendure/common/lib/command';

import type { HostEnvironment, Prompter } from '../host.js';
import { runInTestHost, TestCommandResult } from '../test-command.js';

export type HarnessRun = TestCommandResult;

/**
 * Runs a command through the host the way the CLI does, and fails when `run` or `plan` writes to
 * stdout or stderr. It is `testCommand`, the helper plugins use, with the credential check
 * replaceable, so the CLI's specs test the same path.
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
