import { describe, expect, it } from 'vitest';

import { assertCliPlugin } from '../shared/cli-plugin';

import { builtinCommandDefs } from './builtins';

describe('builtinCommandDefs', () => {
    /**
     * Holds the built-ins to the rules every plugin is already held to.
     *
     * A plugin is validated by `assertCliPlugin` when it loads, so a plugin
     * that declares one flag twice is rejected by name. Nothing validates the
     * built-ins, so the same mistake reached Commander instead — which accepted
     * it until v11 and throws from v13 onwards, failing the whole CLI at
     * startup rather than the one command. `vendure add` had exactly that: it
     * declared `--selected-plugin` under both `-e` and `-s`, and
     * `--selected-service` under both `-j` and `-a`.
     */
    it('satisfies the rules a CLI plugin is validated against', () => {
        expect(() => assertCliPlugin({ id: 'builtins', commands: builtinCommandDefs })).not.toThrow();
    });
});
