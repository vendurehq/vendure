import { describe, expect, it } from 'vitest';

import { BUILT_IN_NAV_ITEM_IDS } from './nav-menu-ids.js';

describe('built-in nav ids', () => {
    it('never repeats an item id', () => {
        const itemIds = Object.values(BUILT_IN_NAV_ITEM_IDS);
        expect(new Set(itemIds).size).toBe(itemIds.length);
    });
});
