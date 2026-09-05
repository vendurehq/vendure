import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { GlobalInterceptorPlugin } from './fixtures/test-plugins/with-global-interceptor';

const GET_PRODUCT_WITH_PROBE = gql`
    query GetProductWithProbe {
        products(options: { take: 1 }) {
            items {
                id
                interceptorProbe
            }
        }
    }
`;

const GET_INTERCEPTED_FIELDS = gql`
    query GetInterceptedFields {
        interceptedFields
    }
`;

/**
 * Resolves the probe field on a Product and returns the list of `Type.field` pairs which the
 * plugin's global APP_INTERCEPTOR was invoked for.
 */
async function resolveProbeAndGetInterceptedFields(adminClient: SimpleGraphQLClient) {
    const { products } = await adminClient.query(GET_PRODUCT_WITH_PROBE);
    expect(products.items[0].interceptorProbe).toBe('probed');

    const { interceptedFields } = await adminClient.query(GET_INTERCEPTED_FIELDS);
    return interceptedFields as string[];
}

describe('apiOptions.fieldResolverEnhancers (default)', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), { plugins: [GlobalInterceptorPlugin] }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('does not run a global interceptor for a field resolver', async () => {
        const interceptedFields = await resolveProbeAndGetInterceptedFields(adminClient);

        expect(interceptedFields).toContain('Query.products');
        expect(interceptedFields).not.toContain('Product.interceptorProbe');
    });
});

describe('apiOptions.fieldResolverEnhancers with "interceptors"', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: {
                fieldResolverEnhancers: ['guards', 'interceptors'],
            },
            plugins: [GlobalInterceptorPlugin],
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

    afterAll(async () => {
        await server.destroy();
    });

    it('runs a global interceptor for a field resolver', async () => {
        const interceptedFields = await resolveProbeAndGetInterceptedFields(adminClient);

        expect(interceptedFields).toContain('Query.products');
        expect(interceptedFields).toContain('Product.interceptorProbe');
    });
});
