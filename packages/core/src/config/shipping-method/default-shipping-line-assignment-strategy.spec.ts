import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { Order } from '../../entity/order/order.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';

import { DefaultShippingLineAssignmentStrategy } from './default-shipping-line-assignment-strategy';

/**
 * Unit tests for the DefaultShippingLineAssignmentStrategy, which assigns every
 * OrderLine of the order to the given ShippingLine (the common single-shipping-
 * method scenario). The `ctx` and `shippingLine` arguments do not affect the
 * result, so partitioning is over the order's line set.
 */
describe('DefaultShippingLineAssignmentStrategy', () => {
    const strategy = new DefaultShippingLineAssignmentStrategy();
    const ctx = {} as RequestContext;
    const shippingLine = {} as ShippingLine;

    it('assigns all of the order lines to the shipping line', async () => {
        const lines = [new OrderLine({ id: 'l1' }), new OrderLine({ id: 'l2' })];
        const order = new Order({ lines });

        const result = await strategy.assignShippingLineToOrderLines(ctx, shippingLine, order);

        expect(result).toEqual(lines);
    });

    it('returns an empty array when the order has no lines', async () => {
        const order = new Order({ lines: [] });

        const result = await strategy.assignShippingLineToOrderLines(ctx, shippingLine, order);

        expect(result).toEqual([]);
    });
});
