import { describe, expect, it } from 'vitest';

import { orderStateDictionary } from './state-type.js';

describe('orderStateDictionary', () => {
    it.each([
        ['Created', 'neutral'],
        ['Draft', 'neutral'],
        ['AddingItems', 'neutral'],
        ['ArrangingPayment', 'neutral'],
        ['PaymentAuthorized', 'info'],
        ['PaymentSettled', 'info'],
        ['PartiallyShipped', 'neutral'],
        ['Shipped', 'neutral'],
        ['PartiallyDelivered', 'neutral'],
        ['Delivered', 'success'],
        ['Modifying', 'warning'],
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

    it('keeps routine states neutral to avoid unnecessary visual noise', () => {
        const quietStates = ['Created', 'Draft', 'ArrangingPayment', 'Shipped', 'Cancelled', 'Settled'];

        expect(quietStates.every(state => orderStateDictionary.toneFor(state) === 'neutral')).toBe(true);
    });
});
