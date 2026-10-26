import { describe, expect, it } from 'vitest';

import { compareIdsForLockOrder } from './stock-lock-order';

describe('compareIdsForLockOrder()', () => {
    it('orders numeric ids by value', () => {
        expect([10, 9, 100, 1].sort(compareIdsForLockOrder)).toEqual([1, 9, 10, 100]);
        expect(['10', '9', '100', '1'].sort(compareIdsForLockOrder)).toEqual(['1', '9', '10', '100']);
    });

    it('orders numeric ids beyond the safe integer range', () => {
        expect(['9007199254740993', '9007199254740992'].sort(compareIdsForLockOrder)).toEqual([
            '9007199254740992',
            '9007199254740993',
        ]);
    });

    it('orders mixed number and string forms of numeric ids consistently', () => {
        expect(compareIdsForLockOrder(9, '10')).toBeLessThan(0);
        expect(compareIdsForLockOrder('10', 9)).toBeGreaterThan(0);
        expect(compareIdsForLockOrder(7, '7')).toBe(0);
    });

    it('orders non-numeric ids as plain strings', () => {
        const ids = ['b2c4', 'a9f0', 'B000'];
        expect([...ids].sort(compareIdsForLockOrder)).toEqual(['B000', 'a9f0', 'b2c4']);
    });
});
