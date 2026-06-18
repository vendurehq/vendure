/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    ChangedPriceHandlingStrategy,
    mergeConfig,
    OrderLine,
    PriceCalculationResult,
    RequestContext,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { updateProductVariantsDocument } from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    adjustItemQuantityDocument,
    getActiveOrderDocument,
} from './graphql/shop-definitions';

class TestChangedPriceStrategy implements ChangedPriceHandlingStrategy {
    static spy = vi.fn();
    static useLatestPrice = true;

    handlePriceChange(
        ctx: RequestContext,
        current: PriceCalculationResult,
        orderLine: OrderLine,
    ): PriceCalculationResult {
        TestChangedPriceStrategy.spy(current);
        if (TestChangedPriceStrategy.useLatestPrice) {
            return current;
        } else {
            return {
                price: orderLine.listPrice,
                priceIncludesTax: orderLine.listPriceIncludesTax,
            };
        }
    }
}

describe('ChangedPriceHandlingStrategy', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                changedPriceHandlingStrategy: new TestChangedPriceStrategy(),
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('unitPriceChangeSinceAdded starts as 0', async () => {
        TestChangedPriceStrategy.spy.mockClear();

        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_12',
            quantity: 1,
        });

        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        expect(activeOrder?.lines[0].unitPriceChangeSinceAdded).toBe(0);
        expect(activeOrder?.lines[0].unitPrice).toBe(5374);
        expect(TestChangedPriceStrategy.spy).not.toHaveBeenCalled();
    });

    describe('use latest price', () => {
        let firstOrderLineId: string;

        beforeAll(() => {
            TestChangedPriceStrategy.useLatestPrice = true;
        });

        it('calls handlePriceChange on addItemToOrder', async () => {
            TestChangedPriceStrategy.spy.mockClear();

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_12',
                        price: 6000,
                    },
                ],
            });

            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_12',
                quantity: 1,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder?.lines[0].unitPriceChangeSinceAdded).toBe(626);
            expect(activeOrder?.lines[0].unitPrice).toBe(6000);
            expect(TestChangedPriceStrategy.spy).toHaveBeenCalledTimes(1);

            firstOrderLineId = activeOrder!.lines[0].id;
        });

        it('calls handlePriceChange on adjustOrderLine', async () => {
            TestChangedPriceStrategy.spy.mockClear();

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_12',
                        price: 3000,
                    },
                ],
            });

            await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: firstOrderLineId,
                quantity: 3,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder?.lines[0].unitPriceChangeSinceAdded).toBe(-2374);
            expect(activeOrder?.lines[0].unitPrice).toBe(3000);
            expect(TestChangedPriceStrategy.spy).toHaveBeenCalledTimes(1);
        });
    });

    describe('use original price', () => {
        let secondOrderLineId: string;
        const ORIGINAL_PRICE = 7896;

        beforeAll(() => {
            TestChangedPriceStrategy.useLatestPrice = false;
        });

        it('calls handlePriceChange on addItemToOrder', async () => {
            TestChangedPriceStrategy.spy.mockClear();

            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_13',
                quantity: 1,
            });

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_13',
                        price: 8000,
                    },
                ],
            });

            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_13',
                quantity: 1,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder?.lines[1].unitPriceChangeSinceAdded).toBe(0);
            expect(activeOrder?.lines[1].unitPrice).toBe(ORIGINAL_PRICE);
            expect(TestChangedPriceStrategy.spy).toHaveBeenCalledTimes(1);

            secondOrderLineId = activeOrder!.lines[1].id;
        });

        it('calls handlePriceChange on adjustOrderLine', async () => {
            TestChangedPriceStrategy.spy.mockClear();

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_13',
                        price: 3000,
                    },
                ],
            });

            await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: secondOrderLineId,
                quantity: 3,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder?.lines[1].unitPriceChangeSinceAdded).toBe(0);
            expect(activeOrder?.lines[1].unitPrice).toBe(ORIGINAL_PRICE);
            expect(TestChangedPriceStrategy.spy).toHaveBeenCalledTimes(1);
        });
    });
});
