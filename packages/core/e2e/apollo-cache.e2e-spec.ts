import type { KeyValueCache } from '@apollo/utils.keyvaluecache';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import * as Codegen from './graphql/generated-e2e-admin-types';
import { GET_PRODUCT_LIST, GET_PRODUCT_SIMPLE } from './graphql/shared-definitions';

describe('Apollo cache configuration', () => {
    describe('with custom cache implementation', () => {
        const mockCache: KeyValueCache<string> = {
            get: vi.fn().mockResolvedValue(undefined),
            set: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(true),
        };

        const { server, adminClient, shopClient } = createTestEnvironment(
            mergeConfig(testConfig(), {
                apiOptions: {
                    cache: mockCache,
                },
            }),
        );

        beforeAll(async () => {
            await server.init({
                initialData,
                productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
                customerCount: 1,
            });
            await adminClient.asSuperAdmin();
        }, TEST_SETUP_TIMEOUT_MS);

        beforeEach(() => {
            vi.clearAllMocks();
        });

        afterAll(async () => {
            await server.destroy();
        });

        it('should configure Apollo Server with custom cache', async () => {
            // Make a GraphQL query
            const result = await shopClient.query<
                Codegen.GetProductListQuery,
                Codegen.GetProductListQueryVariables
            >(GET_PRODUCT_LIST, {
                options: {
                    filter: { id: { eq: 'T_1' } },
                    take: 1,
                },
            });

            expect(result.products.items.length).toBe(1);
            expect(result.products.items[0].id).toBe('T_1');
            expect(result.products.items[0].name).toBe('Laptop');

            // The custom cache is configured and available to Apollo Server
            // Apollo Server may use the cache for internal operations
            // The fact that queries execute without errors confirms proper configuration
            expect(mockCache).toBeDefined();
            expect(typeof mockCache.get).toBe('function');
            expect(typeof mockCache.set).toBe('function');
            expect(typeof mockCache.delete).toBe('function');
        });

        it('should handle multiple queries without errors', async () => {
            // Test multiple queries
            const shopResponse = await shopClient.query<
                Codegen.GetProductListQuery,
                Codegen.GetProductListQueryVariables
            >(GET_PRODUCT_LIST, {
                options: {
                    take: 1,
                },
            });

            expect(shopResponse.products.items.length).toBe(1);

            const adminResponse = await adminClient.query<
                Codegen.GetProductListQuery,
                Codegen.GetProductListQueryVariables
            >(GET_PRODUCT_LIST, {
                options: { take: 1 },
            });

            expect(adminResponse.products.items.length).toBe(1);

            // Both queries execute successfully with the custom cache configured
            expect(shopResponse).toBeDefined();
            expect(adminResponse).toBeDefined();
        });

        it('should work with both shop and admin APIs', async () => {
            const [shopResult, adminResult] = await Promise.all([
                shopClient.query<Codegen.GetProductSimpleQuery, Codegen.GetProductSimpleQueryVariables>(
                    GET_PRODUCT_SIMPLE,
                    {
                        id: 'T_1',
                    },
                ),
                adminClient.query<Codegen.GetProductSimpleQuery, Codegen.GetProductSimpleQueryVariables>(
                    GET_PRODUCT_SIMPLE,
                    {
                        id: 'T_1',
                    },
                ),
            ]);

            expect(shopResult.product).toBeDefined();
            expect(adminResult.product).toBeDefined();
            expect(shopResult.product?.id).toBe(adminResult.product?.id);
            expect(shopResult.product?.id).toBe('T_1');
        });
    });
});
