/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql as graphqlAdmin } from './graphql/graphql-admin';
import { FragmentOf } from './graphql/graphql-shop';
import {
    addManualPaymentToOrderDocument,
    adminTransitionToStateDocument,
    cancelOrderDocument,
    getOrderDocument,
    getStockMovementDocument,
    modifyOrderDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument, testOrderFragment, updatedOrderFragment } from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

describe('Stock control (an OrderLine allocated at two StockLocations)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    const orderGuard: ErrorResultGuard<
        FragmentOf<typeof testOrderFragment> | FragmentOf<typeof updatedOrderFragment>
    > = createErrorResultGuard(input => !!input.lines);

    let secondStockLocationId: string;

    async function getStockLevels(variantId: string) {
        const { productVariant } = await adminClient.query(getVariantStockLevelsDocument, {
            id: variantId,
        });
        return [...productVariant!.stockLevels].sort((a, b) =>
            a.stockLocationId.localeCompare(b.stockLocationId),
        );
    }

    async function getMovementQuantities(variantId: string, type: string) {
        const { product } = await adminClient.query(getStockMovementDocument, { id: 'T_1' });
        return product!.variants
            .find(v => v.id === variantId)!
            .stockMovements.items.filter(m => m.type === type)
            .map(m => m.quantity)
            .sort((a, b) => a - b);
    }

    async function placeOrderSplitAcrossLocations(email: string, variantId: string, quantity = 2) {
        await shopClient.asUserWithCredentials(email, 'test');
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: variantId,
            quantity: 1,
        });
        orderGuard.assertSuccess(addItemToOrder);
        await proceedToArrangingPayment(shopClient);
        const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        const orderId = order.id;
        const lineId = order.lines[0].id;

        await adminClient.query(adminTransitionToStateDocument, { id: orderId, state: 'Modifying' });
        await adminClient.query(modifyOrderDocument, {
            input: {
                dryRun: false,
                orderId,
                adjustOrderLines: [{ orderLineId: lineId, quantity }],
            },
        });
        await adminClient.query(adminTransitionToStateDocument, {
            id: orderId,
            state: 'ArrangingAdditionalPayment',
        });
        await adminClient.query(addManualPaymentToOrderDocument, {
            input: {
                orderId,
                method: testSuccessfulPaymentMethod.code,
                transactionId: `manual-${orderId}`,
                metadata: {},
            },
        });
        await adminClient.query(adminTransitionToStateDocument, { id: orderId, state: 'PaymentSettled' });
        return { orderId, lineId };
    }

    async function cancelUnits(orderId: string, lineId: string, quantity: number) {
        const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
            input: { orderId, lines: [{ orderLineId: lineId, quantity }] },
        });
        orderGuard.assertSuccess(cancelOrder as any);
    }

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control-multi.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
        const { createStockLocation } = await adminClient.query(createStockLocationDocument, {
            input: { name: 'Warehouse 2' },
        });
        secondStockLocationId = createStockLocation.id;
        for (const variantId of ['T_1', 'T_2', 'T_3']) {
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: variantId,
                        stockLevels: [
                            { stockLocationId: 'T_1', stockOnHand: 1 },
                            { stockLocationId: secondStockLocationId, stockOnHand: 5 },
                        ],
                    },
                ],
            });
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('releases each unit from the location which still holds it when a line is cancelled one unit at a time', async () => {
        const { orderId, lineId } = await placeOrderSplitAcrossLocations(
            'trevor_donnelly96@hotmail.com',
            'T_1',
        );
        expect(await getStockLevels('T_1')).toEqual([
            { stockLocationId: 'T_1', stockOnHand: 1, stockAllocated: 1 },
            { stockLocationId: 'T_2', stockOnHand: 5, stockAllocated: 1 },
        ]);

        await cancelUnits(orderId, lineId, 1);
        await cancelUnits(orderId, lineId, 1);

        const { order } = await adminClient.query(getOrderDocument, { id: orderId });
        expect(order!.state).toBe('Cancelled');
        expect(await getStockLevels('T_1')).toEqual([
            { stockLocationId: 'T_1', stockOnHand: 1, stockAllocated: 0 },
            { stockLocationId: 'T_2', stockOnHand: 5, stockAllocated: 0 },
        ]);
        expect(await getMovementQuantities('T_1', 'RELEASE')).toEqual([1, 1]);
    });

    it('records the quantity released at each location when one cancellation spans both', async () => {
        const { orderId, lineId } = await placeOrderSplitAcrossLocations(
            'trevor_donnelly96@hotmail.com',
            'T_2',
        );

        await cancelUnits(orderId, lineId, 2);

        expect(await getStockLevels('T_2')).toEqual([
            { stockLocationId: 'T_1', stockOnHand: 1, stockAllocated: 0 },
            { stockLocationId: 'T_2', stockOnHand: 5, stockAllocated: 0 },
        ]);
        expect(await getMovementQuantities('T_2', 'RELEASE')).toEqual([1, 1]);
    });

    it('keeps releasing from the location which still holds stock after an earlier release spanned both', async () => {
        const { orderId, lineId } = await placeOrderSplitAcrossLocations(
            'trevor_donnelly96@hotmail.com',
            'T_3',
            3,
        );
        expect(await getStockLevels('T_3')).toEqual([
            { stockLocationId: 'T_1', stockOnHand: 1, stockAllocated: 1 },
            { stockLocationId: 'T_2', stockOnHand: 5, stockAllocated: 2 },
        ]);

        await cancelUnits(orderId, lineId, 2);
        await cancelUnits(orderId, lineId, 1);

        expect(await getStockLevels('T_3')).toEqual([
            { stockLocationId: 'T_1', stockOnHand: 1, stockAllocated: 0 },
            { stockLocationId: 'T_2', stockOnHand: 5, stockAllocated: 0 },
        ]);
    });
});

const createStockLocationDocument = graphqlAdmin(`
    mutation CreateStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            id
        }
    }
`);

const getVariantStockLevelsDocument = graphqlAdmin(`
    query GetVariantStockLevels($id: ID!) {
        productVariant(id: $id) {
            id
            stockLevels {
                stockLocationId
                stockOnHand
                stockAllocated
            }
        }
    }
`);
