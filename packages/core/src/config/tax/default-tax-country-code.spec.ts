import { describe, expect, it } from 'vitest';

import { Channel, Order, Zone } from '../../entity';

import { defaultTaxCountryCode } from './default-tax-country-code';

describe('defaultTaxCountryCode()', () => {
    const defaultZone = { id: 'zone-1', name: 'Default Zone' } as Zone;
    const channel = { defaultTaxZone: defaultZone } as Channel;

    it('returns the shipping country', () => {
        const order = { shippingAddress: { countryCode: 'DE' }, billingAddress: { countryCode: 'FR' } };
        expect(defaultTaxCountryCode(channel, defaultZone, order as Order)).toBe('DE');
    });

    it('returns undefined with no shipping country', () => {
        expect(defaultTaxCountryCode(channel, defaultZone, { shippingAddress: {} } as Order)).toBeUndefined();
        expect(
            defaultTaxCountryCode(channel, defaultZone, { shippingAddress: { countryCode: '' } } as Order),
        ).toBeUndefined();
    });

    it('returns undefined with no order', () => {
        expect(defaultTaxCountryCode(channel, defaultZone)).toBeUndefined();
    });
});
