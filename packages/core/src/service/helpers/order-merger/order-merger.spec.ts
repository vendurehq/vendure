import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import { MockConfigService } from '../../../config/config.service.mock';
import { MergeOrdersStrategy } from '../../../config/order/merge-orders-strategy';
import { Order } from '../../../entity/order/order.entity';
import { createOrderFromLines } from '../../../testing/order-test-utils';

import { OrderMerger } from './order-merger';

describe('OrderMerger', () => {
    let orderMerger: OrderMerger;
    const ctx = RequestContext.empty();

    describe('MergeOrdersStrategy', () => {
        beforeEach(async () => {
            const module = await Test.createTestingModule({
                providers: [OrderMerger, { provide: ConfigService, useClass: MockConfigService }],
            }).compile();
            const mockConfigService = module.get<ConfigService, MockConfigService>(ConfigService);
            mockConfigService.orderOptions = {
                mergeStrategy: new MergeOrdersStrategy(),
            };
            orderMerger = module.get(OrderMerger);
        });

        it('both orders undefined', async () => {
            const guestOrder = new Order({ lines: [] });
            const existingOrder = new Order({ lines: [] });

            const result = await orderMerger.merge(ctx);

            expect(result.order).toBeUndefined();
            expect(result.linesToInsert).toBeUndefined();
            expect(result.linesToModify).toBeUndefined();
            expect(result.linesToDelete).toBeUndefined();
            expect(result.orderToDelete).toBeUndefined();
        });

        it('guestOrder undefined', async () => {
            const existingOrder = createOrderFromLines([{ lineId: 1, quantity: 2, productVariantId: 100 }]);

            const result = await orderMerger.merge(ctx, undefined, existingOrder);

            expect(result.order).toBe(existingOrder);
            expect(result.linesToInsert).toBeUndefined();
            expect(result.linesToModify).toBeUndefined();
            expect(result.linesToDelete).toBeUndefined();
            expect(result.orderToDelete).toBeUndefined();
        });

        it('existingOrder undefined', async () => {
            const guestOrder = createOrderFromLines([{ lineId: 1, quantity: 2, productVariantId: 100 }]);

            const result = await orderMerger.merge(ctx, guestOrder, undefined);

            expect(result.order).toBe(guestOrder);
            expect(result.linesToInsert).toBeUndefined();
            expect(result.linesToModify).toBeUndefined();
            expect(result.linesToDelete).toBeUndefined();
            expect(result.orderToDelete).toBeUndefined();
        });

        it('empty guestOrder', async () => {
            const guestOrder = createOrderFromLines([]);
            guestOrder.id = 42;
            const existingOrder = createOrderFromLines([{ lineId: 1, quantity: 2, productVariantId: 100 }]);

            const result = await orderMerger.merge(ctx, guestOrder, existingOrder);

            expect(result.order).toBe(existingOrder);
            expect(result.linesToInsert).toBeUndefined();
            expect(result.linesToModify).toBeUndefined();
            expect(result.linesToDelete).toBeUndefined();
            expect(result.orderToDelete).toBe(guestOrder);
        });

        it('empty existingOrder', async () => {
            const guestOrder = createOrderFromLines([{ lineId: 1, quantity: 2, productVariantId: 100 }]);
            const existingOrder = createOrderFromLines([]);
            existingOrder.id = 42;

            const result = await orderMerger.merge(ctx, guestOrder, existingOrder);

            expect(result.order).toBe(guestOrder);
            expect(result.linesToInsert).toBeUndefined();
            expect(result.linesToModify).toBeUndefined();
            expect(result.linesToDelete).toBeUndefined();
            expect(result.orderToDelete).toBe(existingOrder);
        });

        it('new lines added by merge', async () => {
            const guestOrder = createOrderFromLines([{ lineId: 20, quantity: 2, productVariantId: 200 }]);
            guestOrder.id = 42;
            const existingOrder = createOrderFromLines([{ lineId: 1, quantity: 2, productVariantId: 100 }]);

            const result = await orderMerger.merge(ctx, guestOrder, existingOrder);

            expect(result.order).toBe(existingOrder);
            expect(result.linesToInsert).toEqual([{ productVariantId: 200, quantity: 2 }]);
            expect(result.linesToModify).toEqual([]);
            expect(result.linesToDelete).toEqual([]);
            expect(result.orderToDelete).toBe(guestOrder);
        });

        it('guest quantity replaces existing quantity', async () => {
            const guestOrder = createOrderFromLines([{ lineId: 20, quantity: 2, productVariantId: 100 }]);
            guestOrder.id = 42;
            const existingOrder = createOrderFromLines([{ lineId: 1, quantity: 4, productVariantId: 100 }]);

            const result = await orderMerger.merge(ctx, guestOrder, existingOrder);

            expect(result.order).toBe(existingOrder);
            expect(result.linesToInsert).toEqual([]);
            expect(result.linesToModify).toEqual([{ orderLineId: 1, quantity: 2 }]);
            expect(result.linesToDelete).toEqual([]);
            expect(result.orderToDelete).toBe(guestOrder);
        });

        it('takes customFields into account', async () => {
            const guestOrder = createOrderFromLines([
                { lineId: 20, quantity: 2, productVariantId: 200, customFields: { foo: 'bar' } },
            ]);
            guestOrder.id = 42;
            const existingOrder = createOrderFromLines([{ lineId: 1, quantity: 2, productVariantId: 100 }]);

            const result = await orderMerger.merge(ctx, guestOrder, existingOrder);

            expect(result.order).toBe(existingOrder);
            expect(result.linesToInsert).toEqual([
                { productVariantId: 200, quantity: 2, customFields: { foo: 'bar' } },
            ]);
            expect(result.orderToDelete).toBe(guestOrder);
        });
    });
});
