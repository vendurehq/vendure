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

    describe('with a tax country', () => {
        const otherZone = { id: 'zone-2', name: 'Other Zone' } as Zone;
        const channelWithTaxCountry = { defaultTaxZone: defaultZone, taxCountryCode: 'DE' } as Channel;

        it('the shipping country still wins', () => {
            const order = { shippingAddress: { countryCode: 'FR' } } as Order;
            expect(defaultTaxCountryCode(channelWithTaxCountry, defaultZone, order)).toBe('FR');
        });

        it('returns the tax country with no shipping country, in the default tax zone', () => {
            expect(defaultTaxCountryCode(channelWithTaxCountry, defaultZone)).toBe('DE');
            expect(
                defaultTaxCountryCode(channelWithTaxCountry, defaultZone, { shippingAddress: {} } as Order),
            ).toBe('DE');
        });

        it('returns undefined with no shipping country, in another zone', () => {
            expect(defaultTaxCountryCode(channelWithTaxCountry, otherZone)).toBeUndefined();
        });
    });
});
