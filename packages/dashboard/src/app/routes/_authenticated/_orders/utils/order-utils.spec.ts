import { describe, expect, it } from 'vitest';

import { Order } from './order-types.js';
import {
    canCancelOrderWithoutRefund,
    getMaxRefundableQuantity,
    getRefundableQuantity,
    lineCanBeRefunded,
    toAddressCustomFieldsInput,
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

// #3439 — the custom fields of an Address must be kept when it is set on a draft order
describe('toAddressCustomFieldsInput', () => {
    const deliveryNote = { name: 'deliveryNote', type: 'string' };
    const verifiedAt = { name: 'verifiedAt', type: 'datetime', readonly: true };
    const depot = { name: 'depot', type: 'relation' };

    it('keeps writable fields', () => {
        expect(toAddressCustomFieldsInput({ deliveryNote: 'Side door' }, [deliveryNote])).toEqual({
            deliveryNote: 'Side door',
        });
    });

    it('leaves out readonly fields, which are not part of the input', () => {
        expect(
            toAddressCustomFieldsInput({ deliveryNote: 'Side door', verifiedAt: '2026-01-01' }, [
                deliveryNote,
                verifiedAt,
            ]),
        ).toEqual({ deliveryNote: 'Side door' });
    });

    it('replaces a relation with its id', () => {
        expect(toAddressCustomFieldsInput({ depot: { id: '4' } }, [depot])).toEqual({ depotId: '4' });
    });

    it('leaves out keys that are not configured custom fields', () => {
        expect(
            toAddressCustomFieldsInput({ deliveryNote: 'Side door', __typename: 'AddressCustomFields' }, [
                deliveryNote,
            ]),
        ).toEqual({ deliveryNote: 'Side door' });
    });

    it('returns undefined when there are no custom fields', () => {
        expect(toAddressCustomFieldsInput(undefined, [deliveryNote])).toBeUndefined();
        expect(toAddressCustomFieldsInput(null, [deliveryNote])).toBeUndefined();
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
