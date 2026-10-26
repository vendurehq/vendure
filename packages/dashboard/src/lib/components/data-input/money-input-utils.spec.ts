import { describe, expect, it } from 'vitest';

import { formatMoneyInputValue, getMoneyInputStep } from './money-input-utils.js';

// #5447: MoneyInput must display and round-trip at moneyStrategyPrecision decimals
describe('MoneyInput precision helpers', () => {
    it('formats minor units with 2 decimals at precision 2', () => {
        expect(formatMoneyInputValue(1299, 2)).toBe('12.99');
        expect(formatMoneyInputValue(0, 2)).toBe('0.00');
    });

    it('keeps the third decimal at precision 3', () => {
        expect(formatMoneyInputValue(275, 3)).toBe('0.275');
        expect(formatMoneyInputValue(0, 3)).toBe('0.000');
    });

    it('formats whole units at precision 0', () => {
        expect(formatMoneyInputValue(42, 0)).toBe('42');
    });

    it('round-trips the displayed value back to the same minor units at precision 3', () => {
        const displayed = formatMoneyInputValue(275, 3);
        expect(Math.round(parseFloat(displayed) * 1000)).toBe(275);
    });

    it('uses the smallest unit of the precision as the step', () => {
        expect(getMoneyInputStep(2)).toBe(0.01);
        expect(getMoneyInputStep(3)).toBe(0.001);
        expect(getMoneyInputStep(0)).toBe(1);
    });
});
