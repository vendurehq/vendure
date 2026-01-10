import { createTestEnvironment } from '@vendure/testing';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../e2e-common/test-config';

describe('Order race conditions', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, '../../e2e-common/fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await shopClient.asUserWithCredentials('test@vendure.io', 'test');
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('handles parallel modifications to the order correctly', async () => {
        const ADD_ITEM_TO_ORDER = `
            mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
                addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
                    ... on Order {
                        id
                        totalQuantity
                        total
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `;

        const variantId = 'T_1'; // Laptop 13 inch 8GB
        const quantityPerRequest = 1;
        const concurrency = 5;

        // Executing  5 Simulataneous requests to add an item
        const promises: Array<Promise<any>> = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(
                shopClient.query(ADD_ITEM_TO_ORDER, {
                    productVariantId: variantId,
                    quantity: quantityPerRequest,
                }),
            );
        }

        await Promise.all(promises);

        const { activeOrder } = await shopClient.query(`
            query GetActiveOrder { activeOrder { totalQuantity } }
        `);

        // Si hay condición de carrera, el total será menor a 5 (algunas escrituras se sobrescribieron)
        expect(activeOrder.totalQuantity).toBe(concurrency * quantityPerRequest);
    });
});
