import { DEFAULT_STOCK_LOCATION_PARTITION_KEY, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql } from './graphql/graphql-admin';

// ========================================
// GraphQL Documents
// ========================================

const getStockLevelsForVariantDocument = graphql(`
    query GetStockLevelsForVariantWithPartition($id: ID!) {
        productVariant(id: $id) {
            id
            stockLevels {
                id
                stockOnHand
                stockAllocated
                stockLocationId
                partitionKey
            }
        }
    }
`);

const setStockLevelWithPartitionDocument = graphql(`
    mutation SetStockLevelWithPartition($input: UpdateProductVariantInput!) {
        updateProductVariants(input: [$input]) {
            id
            stockLevels {
                id
                stockOnHand
                stockAllocated
                stockLocationId
                partitionKey
            }
        }
    }
`);

// ========================================
// Test Suite
// ========================================

describe('Stock level partitionKey', () => {
    const defaultStockLocationId = 'T_1';
    const variantId = 'T_1';

    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('default stock level has empty partitionKey', async () => {
        const { productVariant } = await adminClient.query(getStockLevelsForVariantDocument, {
            id: variantId,
        });

        expect(productVariant?.stockLevels.length).toBeGreaterThanOrEqual(1);
        const defaultLevel = productVariant?.stockLevels.find(
            sl => sl.stockLocationId === defaultStockLocationId,
        );
        expect(defaultLevel).toBeDefined();
        expect(defaultLevel?.partitionKey).toBe(DEFAULT_STOCK_LOCATION_PARTITION_KEY);
    });

    it('can set stock with a partitionKey', async () => {
        const { updateProductVariants } = await adminClient.query(setStockLevelWithPartitionDocument, {
            input: {
                id: variantId,
                stockLevels: [
                    {
                        stockLocationId: defaultStockLocationId,
                        stockOnHand: 50,
                        partitionKey: 'BATCH-001',
                    },
                ],
            },
        });

        const levels = updateProductVariants[0]?.stockLevels ?? [];
        const batchLevel = levels.find(sl => sl.partitionKey === 'BATCH-001');
        expect(batchLevel).toBeDefined();
        expect(batchLevel?.stockOnHand).toBe(50);
        expect(batchLevel?.stockLocationId).toBe(defaultStockLocationId);
    });

    it('can set a second partition for the same variant and location', async () => {
        const { updateProductVariants } = await adminClient.query(setStockLevelWithPartitionDocument, {
            input: {
                id: variantId,
                stockLevels: [
                    {
                        stockLocationId: defaultStockLocationId,
                        stockOnHand: 30,
                        partitionKey: 'BATCH-002',
                    },
                ],
            },
        });

        const levels = updateProductVariants[0]?.stockLevels ?? [];
        const batch1 = levels.find(sl => sl.partitionKey === 'BATCH-001');
        const batch2 = levels.find(sl => sl.partitionKey === 'BATCH-002');

        expect(batch1).toBeDefined();
        expect(batch1?.stockOnHand).toBe(50);
        expect(batch2).toBeDefined();
        expect(batch2?.stockOnHand).toBe(30);
    });

    it('partitioned stock levels coexist with the default stock level', async () => {
        const { productVariant } = await adminClient.query(getStockLevelsForVariantDocument, {
            id: variantId,
        });

        const levels = productVariant?.stockLevels ?? [];
        const defaultLevel = levels.find(sl => sl.partitionKey === DEFAULT_STOCK_LOCATION_PARTITION_KEY);
        const batch1 = levels.find(sl => sl.partitionKey === 'BATCH-001');
        const batch2 = levels.find(sl => sl.partitionKey === 'BATCH-002');

        // All three should exist for the same variant + location
        expect(defaultLevel).toBeDefined();
        expect(batch1).toBeDefined();
        expect(batch2).toBeDefined();
        expect(levels.filter(sl => sl.stockLocationId === defaultStockLocationId).length).toBe(3);
    });

    it('updating a partitioned stock level does not affect others', async () => {
        // Capture initial state before update
        const { productVariant: before } = await adminClient.query(getStockLevelsForVariantDocument, {
            id: variantId,
        });
        const beforeLevels = before?.stockLevels ?? [];
        const initialDefaultStock = beforeLevels.find(
            sl => sl.partitionKey === DEFAULT_STOCK_LOCATION_PARTITION_KEY,
        )?.stockOnHand;
        const initialBatch2Stock = beforeLevels.find(sl => sl.partitionKey === 'BATCH-002')?.stockOnHand;

        // Update only BATCH-001
        await adminClient.query(setStockLevelWithPartitionDocument, {
            input: {
                id: variantId,
                stockLevels: [
                    {
                        stockLocationId: defaultStockLocationId,
                        stockOnHand: 99,
                        partitionKey: 'BATCH-001',
                    },
                ],
            },
        });

        const { productVariant } = await adminClient.query(getStockLevelsForVariantDocument, {
            id: variantId,
        });

        const levels = productVariant?.stockLevels ?? [];
        const batch1 = levels.find(sl => sl.partitionKey === 'BATCH-001');
        const batch2 = levels.find(sl => sl.partitionKey === 'BATCH-002');
        const defaultLevel = levels.find(sl => sl.partitionKey === DEFAULT_STOCK_LOCATION_PARTITION_KEY);

        expect(batch1?.stockOnHand).toBe(99); // Updated
        expect(batch2?.stockOnHand).toBe(initialBatch2Stock); // Unchanged
        expect(defaultLevel?.stockOnHand).toBe(initialDefaultStock); // Unchanged
    });
});
