import { describe, expect, it } from 'vitest';

import { toDecimalString } from './decimal-string';

describe('toDecimalString', () => {
    it('pads amounts smaller than one whole unit', () => {
        expect(toDecimalString(5, 2)).toBe('0.05');
        expect(toDecimalString(60, 2)).toBe('0.60');
    });

    it('emits no decimal point for a currency the store keeps whole', () => {
        expect(toDecimalString(1000, 0)).toBe('1000');
    });

    it('honours a store configured for three decimal places', () => {
        expect(toDecimalString(25199, 3)).toBe('25.199');
    });

    it('keeps the sign of a negative amount', () => {
        expect(toDecimalString(-150, 2)).toBe('-1.50');
    });

    it('does not print a negative zero when a fractional amount rounds toward zero', () => {
        expect(toDecimalString(-0.4, 2)).toBe('0.00');
    });

    it('rounds a fractional amount before scaling it', () => {
        expect(toDecimalString(20999.6, 2)).toBe('210.00');
    });

    it('treats a missing amount as zero', () => {
        expect(toDecimalString(undefined, 2)).toBe('0.00');
        expect(toDecimalString(null, 2)).toBe('0.00');
    });
});
