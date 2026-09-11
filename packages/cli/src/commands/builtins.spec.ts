import { describe, expect, it } from 'vitest';

import { assertCliPlugin } from '../shared/cli-plugin';

import { builtinCommandDefs } from './builtins';

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
