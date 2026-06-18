import {
    mergeConfig,
    Order,
    OrderInterceptor,
    OrderLine,
    RequestContext,
    WillAddItemToOrderInput,
    WillAdjustOrderLineInput,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { FragmentOf } from './graphql/graphql-shop';
import {
    addItemToOrderDocument,
    adjustItemQuantityDocument,
    getActiveOrderDocument,
    removeAllOrderLinesDocument,
    removeItemFromOrderDocument,
    testOrderFragment,
} from './graphql/shop-definitions';

class Interceptor1 implements OrderInterceptor {
    willAddItemToOrderSpy = vi.fn();
    willAdjustOrderLineSpy = vi.fn();
    willRemoveItemFromOrderSpy = vi.fn();

    willAddItemToOrder(
        ctx: RequestContext,
        order: Order,
        input: WillAddItemToOrderInput,
    ): Promise<void | string> {
        this.willAddItemToOrderSpy(ctx, order, input);
        return Promise.resolve();
    }

    willAdjustOrderLine(
        ctx: RequestContext,
        order: Order,
        input: WillAdjustOrderLineInput,
    ): Promise<void | string> {
        this.willAdjustOrderLineSpy(ctx, order, input);
        return Promise.resolve();
    }

    willRemoveItemFromOrder(ctx: RequestContext, order: Order, orderLine: OrderLine): Promise<void | string> {
        this.willRemoveItemFromOrderSpy(ctx, order, orderLine);
        return Promise.resolve();
    }
}

class Interceptor2 implements OrderInterceptor {
    async willAddItemToOrder(ctx: RequestContext, order: Order, input: WillAddItemToOrderInput) {
        if (input.productVariant.id === 2 && input.quantity < 2) {
            return 'Quantity must be at least 2';
        }
    }

    async willAdjustOrderLine(
        ctx: RequestContext,
        order: Order,
        input: WillAdjustOrderLineInput,
    ): Promise<void | string> {
        if (input.orderLine.productVariant.id === 2 && input.quantity < 2) {
            return 'Quantity must be at least 2';
        }
    }

    async willRemoveItemFromOrder(
        ctx: RequestContext,
        order: Order,
        orderLine: OrderLine,
    ): Promise<void | string> {
        const overridden = ctx.req?.query?.overridden;
        if (overridden) {
            return;
        }
        if (orderLine.productVariant.id === 2) {
            return 'Cannot remove this item';
        }
    }
}

type TestOrderFragmentType = FragmentOf<typeof testOrderFragment>;
type OrderSuccessResult = TestOrderFragmentType;
const orderResultGuard: ErrorResultGuard<OrderSuccessResult> = createErrorResultGuard(input => !!input.lines);

describe('Order interceptor', () => {
    const interceptor1 = new Interceptor1();
    const interceptor2 = new Interceptor2();

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderInterceptors: [interceptor1, interceptor2],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('willAddItemToOrder', async () => {
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });

        orderResultGuard.assertSuccess(addItemToOrder);
        expect(addItemToOrder.lines.length).toBe(1);

        expect(interceptor1.willAddItemToOrderSpy).toHaveBeenCalled();
        expect(interceptor1.willAddItemToOrderSpy.mock.calls[0][0]).toBeInstanceOf(RequestContext);
        expect(interceptor1.willAddItemToOrderSpy.mock.calls[0][1]).toBeInstanceOf(Order);
        expect(interceptor1.willAddItemToOrderSpy.mock.calls[0][2].quantity).toBe(1);
        expect(interceptor1.willAddItemToOrderSpy.mock.calls[0][2].productVariant.id).toBe(1);
        expect(interceptor1.willAddItemToOrderSpy.mock.calls[0][2].customFields).toBeUndefined();
    });

    it('willAdjustOrderLine', async () => {
        const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
            orderLineId: 'T_1',
            quantity: 2,
        });

        orderResultGuard.assertSuccess(adjustOrderLine);

        expect(interceptor1.willAdjustOrderLineSpy).toHaveBeenCalled();
        expect(interceptor1.willAdjustOrderLineSpy.mock.calls[0][0]).toBeInstanceOf(RequestContext);
        expect(interceptor1.willAdjustOrderLineSpy.mock.calls[0][1]).toBeInstanceOf(Order);
        expect(interceptor1.willAdjustOrderLineSpy.mock.calls[0][2].quantity).toBe(2);
        expect(interceptor1.willAdjustOrderLineSpy.mock.calls[0][2].orderLine.id).toBe(1);
        expect(interceptor1.willAdjustOrderLineSpy.mock.calls[0][2].customFields).toBeUndefined();
    });

    it('willRemoveItemFromOrder when removing an item', async () => {
        const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
            orderLineId: 'T_1',
        });

        orderResultGuard.assertSuccess(removeOrderLine);

        expect(interceptor1.willRemoveItemFromOrderSpy).toHaveBeenCalled();
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[0][0]).toBeInstanceOf(RequestContext);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[0][1]).toBeInstanceOf(Order);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[0][2].productVariant.id).toEqual(1);
    });

    it('willRemoveItemFromOrder when removing all items', async () => {
        const { addItemToOrder: addFirstItem } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 2,
        });

        orderResultGuard.assertSuccess(addFirstItem);

        const { addItemToOrder: addSecondItem } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 2,
        });

        orderResultGuard.assertSuccess(addSecondItem);

        interceptor1.willRemoveItemFromOrderSpy.mockClear();

        const { removeAllOrderLines } = await shopClient.query(removeAllOrderLinesDocument, undefined, {
            overridden: 1,
        });

        orderResultGuard.assertSuccess(removeAllOrderLines);

        expect(interceptor1.willRemoveItemFromOrderSpy).toHaveBeenCalledTimes(2);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[0][0]).toBeInstanceOf(RequestContext);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[0][1]).toBeInstanceOf(Order);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[0][2].productVariant.id).toEqual(1);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[1][0]).toBeInstanceOf(RequestContext);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[1][1]).toBeInstanceOf(Order);
        expect(interceptor1.willRemoveItemFromOrderSpy.mock.calls[1][2].productVariant.id).toEqual(2);
    });

    it('willAddItemToOrder with error', async () => {
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 1,
        });

        orderResultGuard.assertErrorResult(addItemToOrder);
        expect(addItemToOrder.message).toBe('An error occurred when attempting to modify the Order');
        expect(addItemToOrder.interceptorError).toBe('Quantity must be at least 2');
    });

    it('item was not added to order', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        orderResultGuard.assertSuccess(activeOrder);
        expect(activeOrder.lines.length).toBe(0);
    });

    it('add item that passes interceptor check', async () => {
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 2,
        });

        orderResultGuard.assertSuccess(addItemToOrder);
        expect(addItemToOrder.lines.length).toBe(1);
    });

    it('willAdjustOrderLine with error', async () => {
        const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
            orderLineId: 'T_4',
            quantity: 1,
        });

        orderResultGuard.assertErrorResult(adjustOrderLine);

        expect(adjustOrderLine.message).toBe('An error occurred when attempting to modify the Order');
        expect(adjustOrderLine.interceptorError).toBe('Quantity must be at least 2');
    });

    it('item was not adjusted', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        orderResultGuard.assertSuccess(activeOrder);
        expect(activeOrder.lines.length).toBe(1);
        expect(activeOrder.lines[0].quantity).toBe(2);
    });

    it('adjust item that passes interceptor check', async () => {
        const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
            orderLineId: 'T_4',
            quantity: 5,
        });

        orderResultGuard.assertSuccess(adjustOrderLine);
        expect(adjustOrderLine.lines.length).toBe(1);
        expect(adjustOrderLine.lines[0].quantity).toBe(5);
    });

    it('willRemoveItemFromOrder with error', async () => {
        const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
            orderLineId: 'T_4',
        });

        orderResultGuard.assertErrorResult(removeOrderLine);

        expect(removeOrderLine.message).toBe('An error occurred when attempting to modify the Order');
        expect(removeOrderLine.interceptorError).toBe('Cannot remove this item');
    });

    it('item was not removed', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        orderResultGuard.assertSuccess(activeOrder);
        expect(activeOrder.lines.length).toBe(1);
        expect(activeOrder.lines[0].quantity).toBe(5);
    });

    it('remove item that passes interceptor check', async () => {
        const { removeOrderLine } = await shopClient.query(
            removeItemFromOrderDocument,
            {
                orderLineId: 'T_4',
            },
            {
                overridden: 1,
            },
        );

        orderResultGuard.assertSuccess(removeOrderLine);
        expect(removeOrderLine.lines.length).toBe(0);
    });

    it('item was removed', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        orderResultGuard.assertSuccess(activeOrder);
        expect(activeOrder.lines.length).toBe(0);
    });
});
