import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { createOrderFromLines } from '../../testing/order-test-utils';

import { MergeOrdersStrategy } from './merge-orders-strategy';

describe('MergeOrdersStrategy', () => {
    const strategy = new MergeOrdersStrategy();
    const ctx = RequestContext.empty();

    it('both orders empty', () => {
        const guestOrder = new Order({ lines: [] });
        const existingOrder = new Order({ lines: [] });

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([]);
    });

    it('existingOrder empty', () => {
        const guestLines = [{ lineId: 1, quantity: 2, productVariantId: 100 }];
        const guestOrder = createOrderFromLines(guestLines);
        const existingOrder = new Order({ lines: [] });

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([{ orderLineId: 1, quantity: 2 }]);
    });

    it('guestOrder empty', () => {
        const existingLines = [{ lineId: 1, quantity: 2, productVariantId: 100 }];
        const guestOrder = new Order({ lines: [] });
        const existingOrder = createOrderFromLines(existingLines);

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([{ orderLineId: 1, quantity: 2 }]);
    });

    it('both orders have non-conflicting lines', () => {
        const guestLines = [
            { lineId: 21, quantity: 2, productVariantId: 201 },
            { lineId: 22, quantity: 1, productVariantId: 202 },
        ];
        const existingLines = [
            { lineId: 1, quantity: 1, productVariantId: 101 },
            { lineId: 2, quantity: 1, productVariantId: 102 },
            { lineId: 3, quantity: 1, productVariantId: 103 },
        ];
        const guestOrder = createOrderFromLines(guestLines);
        const existingOrder = createOrderFromLines(existingLines);

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([
            { orderLineId: 21, quantity: 2 },
            { orderLineId: 22, quantity: 1 },
            { orderLineId: 1, quantity: 1 },
            { orderLineId: 2, quantity: 1 },
            { orderLineId: 3, quantity: 1 },
        ]);
    });

    it('both orders have lines, some of which conflict', () => {
        const guestLines = [
            { lineId: 21, quantity: 2, productVariantId: 102 },
            { lineId: 22, quantity: 1, productVariantId: 202 },
        ];
        const existingLines = [
            { lineId: 1, quantity: 1, productVariantId: 101 },
            { lineId: 2, quantity: 1, productVariantId: 102 },
            { lineId: 3, quantity: 1, productVariantId: 103 },
        ];
        const guestOrder = createOrderFromLines(guestLines);
        const existingOrder = createOrderFromLines(existingLines);

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([
            { orderLineId: 22, quantity: 1 },
            { orderLineId: 1, quantity: 1 },
            { orderLineId: 2, quantity: 2 },
            { orderLineId: 3, quantity: 1 },
        ]);
    });

    it('equivalent customFields are merged', () => {
        const guestLines = [{ lineId: 21, quantity: 2, productVariantId: 102, customFields: { foo: 'bar' } }];
        const existingLines = [
            { lineId: 2, quantity: 1, productVariantId: 102, customFields: { foo: 'bar' } },
        ];
        const guestOrder = createOrderFromLines(guestLines);
        const existingOrder = createOrderFromLines(existingLines);

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([{ orderLineId: 2, quantity: 2, customFields: { foo: 'bar' } }]);
    });

    it('differing customFields are not merged', () => {
        const guestLines = [{ lineId: 21, quantity: 2, productVariantId: 102, customFields: { foo: 'bar' } }];
        const existingLines = [
            { lineId: 2, quantity: 1, productVariantId: 102, customFields: { foo: 'quux' } },
        ];
        const guestOrder = createOrderFromLines(guestLines);
        const existingOrder = createOrderFromLines(existingLines);

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).toEqual([
            { orderLineId: 21, quantity: 2, customFields: { foo: 'bar' } },
            { orderLineId: 2, quantity: 1, customFields: { foo: 'quux' } },
        ]);
    });

    it('returns a new array', () => {
        const guestLines = [{ lineId: 21, quantity: 2, productVariantId: 102 }];
        const existingLines = [{ lineId: 1, quantity: 1, productVariantId: 101 }];
        const guestOrder = createOrderFromLines(guestLines);
        const existingOrder = createOrderFromLines(existingLines);

        const result = strategy.merge(ctx, guestOrder, existingOrder);

        expect(result).not.toBe(guestOrder.lines);
        expect(result).not.toBe(existingOrder.lines);
    });
});
