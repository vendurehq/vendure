import { SEED_PRESET_KEY as CORE_PRESET_KEY, SEED_SCENARIO_KEY as CORE_SCENARIO_KEY } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { SEED_PRESET_KEY, SEED_SCENARIO_KEY } from './seed-state.js';

// The seed state is read without loading @vendure/core, so the CLI keeps its own copy of the keys.
describe('seed sentinel keys', () => {
    it('match the keys @vendure/core registers', () => {
        expect(SEED_PRESET_KEY).toBe(CORE_PRESET_KEY);
        expect(SEED_SCENARIO_KEY).toBe(CORE_SCENARIO_KEY);
    });
});
