import { describe, expect, it } from 'vitest';

import { orderStateDictionary } from './state-type.js';

describe('orderStateDictionary', () => {
    it.each([
        ['Created', 'neutral'],
        ['Draft', 'neutral'],
        ['AddingItems', 'neutral'],
        ['ArrangingPayment', 'warning'],
        ['PaymentAuthorized', 'info'],
        ['PaymentSettled', 'neutral'],
        ['PartiallyShipped', 'info'],
        ['Shipped', 'neutral'],
        ['PartiallyDelivered', 'info'],
        ['Delivered', 'neutral'],
        ['Modifying', 'progress'],
        ['ArrangingAdditionalPayment', 'warning'],
        ['Cancelled', 'neutral'],
        ['Authorized', 'info'],
        ['Settled', 'neutral'],
        ['Declined', 'critical'],
        ['Error', 'critical'],
        ['Pending', 'warning'],
    ] as const)('maps the default process state %s to %s', (state, tone) => {
        expect(orderStateDictionary.toneFor(state)).toBe(tone);
    });

    it('keeps routine and healthy states neutral to avoid unnecessary visual noise', () => {
        const quietStates = ['Created', 'Draft', 'PaymentSettled', 'Shipped', 'Delivered', 'Settled'];

        expect(quietStates.every(state => orderStateDictionary.toneFor(state) === 'neutral')).toBe(true);
    });
});
