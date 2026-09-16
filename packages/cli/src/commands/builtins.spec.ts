import { describe, expect, it } from 'vitest';

import { runCli } from '../shared/__tests__/run-cli';
import { assertCliPlugin } from '../shared/cli-plugin';

import { builtinCommandDefs } from './builtins';
import { doctorCommandDef } from './doctor/command';
import { migrateCommandDef } from './migrate/command';

describe('builtinCommandDefs', () => {
    /**
     * Holds the built-ins to the rules every plugin is already held to.
     *
     * `assertCliPlugin` validates a plugin when it loads, so a plugin that
     * declares one flag twice is rejected by name. Nothing validates the
     * built-ins, so the same mistake reaches Commander instead. Commander
     * accepts a repeated flag up to v11 and throws from v13. The throw happens
     * while a built-in is registered, so every `vendure` command fails at
     * startup, not just the one that declared the flag.
     *
     * A built-in repeats a flag when one sub-option is declared under two
     * parent options: every sub-option is flattened onto the same command, so
     * the flag arrives twice.
     */
    it('satisfies the rules a CLI plugin is validated against', () => {
        expect(() => assertCliPlugin({ id: 'builtins', commands: builtinCommandDefs })).not.toThrow();
    });
});

describe('builtinCommandDefs project gate', () => {
    /**
     * Named rather than counted, so adding a command is a deliberate decision
     * about whether it can run outside a project instead of a number to bump.
     */
    it('gates exactly the commands that read or write the project they run in', () => {
        const gated = builtinCommandDefs
            .filter(command => command.requiresProject)
            .map(command => command.name)
            .sort();

        expect(gated).toEqual(['add', 'build', 'console', 'dev', 'migrate', 'schema', 'start']);
    });

    it('leaves the commands that work anywhere ungated', () => {
        const ungated = builtinCommandDefs
            .filter(command => !command.requiresProject)
            .map(command => command.name)
            .sort();

        expect(ungated).toEqual(['codemod', 'doctor', 'plugins']);
    });

    /**
     * The gate has to refuse before the action runs, because the action is
     * where the implementation is imported, and an implementation is free to
     * import whatever it needs from the project at module level.
     */
    it('refuses a gated built-in before importing its implementation', async () => {
        const result = await runCli([migrateCommandDef], [], ['migrate'], undefined, () => undefined);

        expect(result.exitCode).toBe(1);
        expect(result.processStderr).toContain(
            'vendure migrate must be run from a Vendure project directory.',
        );
    });

    /**
     * Doctor is the exception, and deliberately so: reporting that a directory
     * is not a Vendure project is one of its checks, so it has to be able to
     * run where that is true.
     */
    it('does not refuse doctor outside a project', async () => {
        expect(doctorCommandDef.requiresProject).toBeUndefined();
    });
});
