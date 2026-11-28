import { describe, expect, it } from 'vitest';

import {
    formatMoneyInputValue,
    getDecimalSeparator,
    getMoneyInputStep,
    isMoneyInputText,
    parseMoneyInputValue,
} from './money-input-utils.js';

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

// #5969 — the money input must accept the display locale's decimal separator
describe('MoneyInput decimal separator helpers', () => {
    it('reads the decimal separator of the locale', () => {
        expect(getDecimalSeparator('en-US')).toBe('.');
        expect(getDecimalSeparator('de-DE')).toBe(',');
        expect(getDecimalSeparator('fr-FR')).toBe(',');
        expect(getDecimalSeparator('en-DE')).toBe(',');
    });

    it('falls back to a dot for an invalid locale', () => {
        expect(getDecimalSeparator('not a locale!')).toBe('.');
    });

    it('formats with the given decimal separator', () => {
        expect(formatMoneyInputValue(150, 2, ',')).toBe('1,50');
        expect(formatMoneyInputValue(42, 0, ',')).toBe('42');
    });

    it('accepts digits with at most one decimal separator', () => {
        expect(isMoneyInputText('1,50', ',')).toBe(true);
        expect(isMoneyInputText('1.50', ',')).toBe(true);
        expect(isMoneyInputText(',5', ',')).toBe(true);
        expect(isMoneyInputText('1,5,0', ',')).toBe(false);
        expect(isMoneyInputText('1.5,0', ',')).toBe(false);
        expect(isMoneyInputText('1,50', '.')).toBe(false);
        expect(isMoneyInputText('1.5.0', '.')).toBe(false);
        expect(isMoneyInputText('1e5', '.')).toBe(false);
        expect(isMoneyInputText('-1', '.')).toBe(false);
    });

    it('parses the locale decimal separator as a decimal point', () => {
        expect(parseMoneyInputValue('1,50', ',')).toBe(1.5);
        expect(parseMoneyInputValue('1.50', ',')).toBe(1.5);
        expect(parseMoneyInputValue(',', ',')).toBeNaN();
    });
});
