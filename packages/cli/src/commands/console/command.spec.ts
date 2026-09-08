import { describe, expect, it } from 'vitest';

import { consoleCommandDef } from './command';

describe('console command definition', () => {
    // Every other test calls `consoleCommand` directly, so the flags the person
    // actually types were reachable only through this file.
    it.each(['--allow-custom-console', '--project <path>', '--force', '--yes'])('registers %s', flag => {
        expect(consoleCommandDef.options?.map(option => option.long)).toContain(flag);
    });

    it('takes the action as an optional argument', () => {
        expect(consoleCommandDef.arguments?.[0]).toMatchObject({ name: 'action', required: false });
    });
});
