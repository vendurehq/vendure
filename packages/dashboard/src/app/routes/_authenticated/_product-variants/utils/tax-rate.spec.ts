import { describe, expect, it } from 'vitest';

import { getTaxRate } from './tax-rate.js';

const rates = [
    { value: 20, zone: { id: 'zone-1' }, category: { id: 'standard' } },
    { value: 5, zone: { id: 'zone-2' }, category: { id: 'standard' } },
];
const channel = { defaultTaxZone: { id: 'zone-1' } };

// OSS-1512 — the variant page showed 0% tax until the tax rates loaded
describe('getTaxRate', () => {
    it('is unknown while the tax rates load', () => {
        expect(getTaxRate(undefined, channel, 'standard')).toBeUndefined();
    });

    it('is unknown while the Channel loads, even with tax rates', () => {
        expect(getTaxRate(rates, undefined, 'standard')).toBeUndefined();
    });

    it('takes the rate of the category in the default tax zone', () => {
        expect(getTaxRate(rates, channel, 'standard')).toBe(20);
    });

    it('is 0 without a matching rate or a default tax zone', () => {
        expect(getTaxRate(rates, channel, 'reduced')).toBe(0);
        expect(getTaxRate(rates, { defaultTaxZone: null }, 'standard')).toBe(0);
    });
});
