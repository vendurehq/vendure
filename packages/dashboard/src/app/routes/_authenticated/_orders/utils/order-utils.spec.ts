import { describe, expect, it } from 'vitest';

import { Order } from './order-types.js';
import {
    canCancelOrderWithoutRefund,
    compareModificationDiscounts,
    computePendingOrder,
    couponCodesChanged,
    getMaxRefundableQuantity,
    getRefundableQuantity,
    getShippingLineLabel,
    lineCanBeRefunded,
    toCustomFieldsInput,
    toModifyOrderInput,
} from './order-utils.js';

// #4728 — refund dialog must reflect quantities/items changed during order modification.
// Lines added or increased while the order is in `Modifying` keep `orderPlacedQuantity` at
// its placement value (0 for new lines), so the effective refundable quantity is
// Math.max(orderPlacedQuantity, quantity), matching how core distributes discounts/prices.

function orderWithRefunds(refunds: Array<{ orderLineId: string; quantity: number; state?: string }>): Order {
    return {
        payments: [
            {
                state: 'Settled',
                refunds: refunds.map(r => ({
                    state: r.state ?? 'Settled',
                    lines: [{ orderLineId: r.orderLineId, quantity: r.quantity }],
                })),
            },
        ],
    } as any;
}

function line(opts: { id?: string; orderPlacedQuantity: number; quantity: number }) {
    return {
        id: opts.id ?? 'L1',
        orderPlacedQuantity: opts.orderPlacedQuantity,
        quantity: opts.quantity,
    } as Order['lines'][number];
}

describe('getRefundableQuantity', () => {
    it('uses orderPlacedQuantity when it is the greater value', () => {
        expect(getRefundableQuantity(line({ orderPlacedQuantity: 3, quantity: 1 }))).toBe(3);
    });

    it('uses the current quantity when a line was increased or added after placement', () => {
        expect(getRefundableQuantity(line({ orderPlacedQuantity: 1, quantity: 2 }))).toBe(2);
        expect(getRefundableQuantity(line({ orderPlacedQuantity: 0, quantity: 1 }))).toBe(1);
    });
});

describe('lineCanBeRefunded', () => {
    it('allows refunding a line added after the order was placed (orderPlacedQuantity 0)', () => {
        const order = orderWithRefunds([]);
        expect(lineCanBeRefunded(order, line({ orderPlacedQuantity: 0, quantity: 1 }))).toBe(true);
    });

    it('allows refunding units added by increasing a line during modification', () => {
        const order = orderWithRefunds([]);
        expect(lineCanBeRefunded(order, line({ orderPlacedQuantity: 1, quantity: 2 }))).toBe(true);
    });

    it('still allows refunding remaining units after a partial cancel+refund (#2608)', () => {
        // Placed qty 3, then 2 cancelled+refunded → quantity reduced to 1, refundedCount 2.
        const order = orderWithRefunds([{ orderLineId: 'L1', quantity: 2 }]);
        expect(lineCanBeRefunded(order, line({ orderPlacedQuantity: 3, quantity: 1 }))).toBe(true);
    });

    it('does not allow refunding a fully refunded line', () => {
        const order = orderWithRefunds([{ orderLineId: 'L1', quantity: 2 }]);
        expect(lineCanBeRefunded(order, line({ orderPlacedQuantity: 2, quantity: 0 }))).toBe(false);
    });
});

describe('canCancelOrderWithoutRefund', () => {
    function placedOrder(overrides: Record<string, unknown> = {}): Order {
        return {
            type: 'Regular',
            active: false,
            state: 'PaymentAuthorized',
            nextStates: ['PaymentSettled', 'Cancelled', 'Modifying', 'ArrangingAdditionalPayment'],
            payments: [{ state: 'Authorized' }],
            ...overrides,
        } as any;
    }

    it('allows cancelling a placed order whose only payment is authorized', () => {
        expect(canCancelOrderWithoutRefund(placedOrder())).toBe(true);
    });

    it('allows cancelling an order awaiting an additional payment with only an authorized payment', () => {
        const order = placedOrder({
            state: 'ArrangingAdditionalPayment',
            nextStates: ['PaymentAuthorized', 'PaymentSettled', 'Cancelled'],
        });
        expect(canCancelOrderWithoutRefund(order)).toBe(true);
    });

    it('ignores payments which never settled', () => {
        const order = placedOrder({
            payments: [{ state: 'Declined' }, { state: 'Cancelled' }, { state: 'Authorized' }],
        });
        expect(canCancelOrderWithoutRefund(order)).toBe(true);
    });

    it('does not allow it when a payment is settled, because the order can be refunded', () => {
        expect(canCancelOrderWithoutRefund(placedOrder({ payments: [{ state: 'Settled' }] }))).toBe(false);
        expect(
            canCancelOrderWithoutRefund(
                placedOrder({ payments: [{ state: 'Authorized' }, { state: 'Settled' }] }),
            ),
        ).toBe(false);
    });

    it('does not allow it when the order cannot move to Cancelled', () => {
        expect(canCancelOrderWithoutRefund(placedOrder({ state: 'Cancelled', nextStates: [] }))).toBe(false);
        expect(
            canCancelOrderWithoutRefund(
                placedOrder({ state: 'Modifying', nextStates: ['PaymentAuthorized'] }),
            ),
        ).toBe(false);
    });

    it('does not allow it for active orders', () => {
        expect(canCancelOrderWithoutRefund(placedOrder({ active: true, state: 'ArrangingPayment' }))).toBe(
            false,
        );
    });

    it('does not allow it for seller and aggregate orders', () => {
        expect(canCancelOrderWithoutRefund(placedOrder({ type: 'Seller', payments: [] }))).toBe(false);
        expect(canCancelOrderWithoutRefund(placedOrder({ type: 'Aggregate' }))).toBe(false);
    });
});

describe('getMaxRefundableQuantity', () => {
    it('returns the current quantity for a line added after placement', () => {
        const order = orderWithRefunds([]);
        expect(getMaxRefundableQuantity(order, line({ orderPlacedQuantity: 0, quantity: 1 }))).toBe(1);
    });

    it('returns the increased quantity for a line modified during Modifying', () => {
        const order = orderWithRefunds([]);
        expect(getMaxRefundableQuantity(order, line({ orderPlacedQuantity: 1, quantity: 2 }))).toBe(2);
    });

    it('subtracts already-refunded units from the effective quantity (#2608)', () => {
        const order = orderWithRefunds([{ orderLineId: 'L1', quantity: 2 }]);
        expect(getMaxRefundableQuantity(order, line({ orderPlacedQuantity: 3, quantity: 1 }))).toBe(1);
    });

    it('never returns a negative quantity', () => {
        const order = orderWithRefunds([{ orderLineId: 'L1', quantity: 2 }]);
        expect(getMaxRefundableQuantity(order, line({ orderPlacedQuantity: 2, quantity: 0 }))).toBe(0);
    });
});

describe('toCustomFieldsInput', () => {
    const giftFrom = { name: 'giftFrom', type: 'relation' };
    const giftTags = { name: 'giftTags', type: 'relation', list: true };
    const note = { name: 'note', type: 'string' };

    it('replaces a single relation with its id', () => {
        expect(toCustomFieldsInput({ giftFrom: { id: '3', name: 'x' } }, [giftFrom])).toEqual({
            giftFromId: '3',
        });
    });

    it('converts a null relation to a null id', () => {
        expect(toCustomFieldsInput({ giftFrom: null }, [giftFrom])).toEqual({ giftFromId: null });
    });

    it('replaces a list relation with its ids', () => {
        expect(toCustomFieldsInput({ giftTags: [{ id: '1' }, { id: '2' }] }, [giftTags])).toEqual({
            giftTagsIds: ['1', '2'],
        });
        expect(toCustomFieldsInput({ giftTags: null }, [giftTags])).toEqual({ giftTagsIds: null });
    });

    it('leaves non-relation fields unchanged', () => {
        expect(toCustomFieldsInput({ note: 'hi', giftFrom: null }, [note, giftFrom])).toEqual({
            note: 'hi',
            giftFromId: null,
        });
    });

    it('keeps a value already set under the input name', () => {
        expect(toCustomFieldsInput({ giftFrom: { id: '3' }, giftFromId: '7' }, [giftFrom])).toEqual({
            giftFromId: '7',
        });
    });

    it('returns undefined for undefined custom fields', () => {
        expect(toCustomFieldsInput(undefined, [giftFrom])).toBeUndefined();
    });
});

describe('toModifyOrderInput', () => {
    it('converts the custom fields of adjusted and added lines', () => {
        const input = {
            orderId: '1',
            dryRun: true,
            adjustOrderLines: [{ orderLineId: 'L1', quantity: 2, customFields: { giftFrom: { id: '3' } } }],
            addItems: [{ productVariantId: 'V1', quantity: 1, customFields: { giftFrom: null } }],
        } as any;
        const result = toModifyOrderInput(input, [{ name: 'giftFrom', type: 'relation' }]) as any;
        expect(result.adjustOrderLines[0].customFields).toEqual({ giftFromId: '3' });
        expect(result.addItems[0].customFields).toEqual({ giftFromId: null });
        expect(input.adjustOrderLines[0].customFields).toEqual({ giftFrom: { id: '3' } });
    });
});

// OSS-1003 / #2649 — a ShippingMethod can offer several priced options
describe('computePendingOrder shipping options', () => {
    const order = { lines: [], shippingLines: [] } as unknown as Order;
    const carrier = {
        id: 'SM1',
        name: 'Carrier',
        priceWithTax: 500,
        options: [
            { code: 'economy', name: 'Economy', priceWithTax: 500 },
            { code: 'express', name: 'Express', priceWithTax: 1500 },
        ],
    };

    it('previews the chosen option', () => {
        const pending = computePendingOrder(
            order,
            {
                orderId: '1',
                dryRun: true,
                shippingMethods: [{ shippingMethodId: 'SM1', shippingOptionCode: 'express' }],
            },
            new Map(),
            [carrier],
        );
        expect(pending.shippingLines[0]).toMatchObject({
            discountedPriceWithTax: 1500,
            shippingOptionCode: 'express',
            shippingOptionName: 'Express',
        });
        expect(pending.shippingLines[0].shippingMethod).not.toHaveProperty('options');
    });

    it('previews the cheapest option when only the ShippingMethod id is given', () => {
        const pending = computePendingOrder(
            order,
            { orderId: '1', dryRun: true, shippingMethodIds: ['SM1'] },
            new Map(),
            [carrier],
        );
        expect(pending.shippingLines[0]).toMatchObject({
            discountedPriceWithTax: 500,
            shippingOptionCode: 'economy',
        });
    });
});

describe('getShippingLineLabel', () => {
    it('appends the name of the chosen option', () => {
        expect(
            getShippingLineLabel({ shippingMethod: { name: 'Carrier' }, shippingOptionName: 'Express' }),
        ).toBe('Carrier: Express');
    });

    it('is the ShippingMethod name when there is no option', () => {
        expect(
            getShippingLineLabel({ shippingMethod: { name: 'Flat rate' }, shippingOptionName: null }),
        ).toBe('Flat rate');
    });
});

// #5356 — the modification preview asks which discounts to keep when re-applying the
// promotions would change them
describe('compareModificationDiscounts', () => {
    const tenPercent = { adjustmentSource: 'PROMOTION:1', description: '10% off', amountWithTax: -400 };

    it('returns nothing when both previews are the same', () => {
        const preview = { totalWithTax: 3600, discounts: [tenPercent] };
        expect(compareModificationDiscounts(preview, { ...preview })).toEqual([]);
    });

    it('lists a discount which re-applying the promotions removes', () => {
        expect(
            compareModificationDiscounts(
                { totalWithTax: 3600, discounts: [tenPercent] },
                { totalWithTax: 4000, discounts: [] },
            ),
        ).toEqual([
            {
                adjustmentSource: 'PROMOTION:1',
                description: '10% off',
                keptAmountWithTax: -400,
                reappliedAmountWithTax: null,
            },
        ]);
    });

    it('lists a discount whose amount changes', () => {
        expect(
            compareModificationDiscounts(
                { totalWithTax: 5600, discounts: [tenPercent] },
                { totalWithTax: 5400, discounts: [{ ...tenPercent, amountWithTax: -600 }] },
            ),
        ).toEqual([
            {
                adjustmentSource: 'PROMOTION:1',
                description: '10% off',
                keptAmountWithTax: -400,
                reappliedAmountWithTax: -600,
            },
        ]);
    });
});

describe('couponCodesChanged', () => {
    it('ignores case and order', () => {
        expect(couponCodesChanged(['SUMMER', 'Gift'], ['gift', 'summer'])).toBe(false);
    });

    it('is false when no coupon codes are given', () => {
        expect(couponCodesChanged(['SUMMER'], undefined)).toBe(false);
    });

    it('detects an added or a removed code', () => {
        expect(couponCodesChanged(['SUMMER'], ['SUMMER', 'NEW'])).toBe(true);
        expect(couponCodesChanged(['SUMMER'], [])).toBe(true);
    });
});
