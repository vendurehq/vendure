import { LanguageCode } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const updateProductNamedFragmentDocument = gql`
    mutation UpdateNamed($input: UpdateProductInput!) {
        ...UpdateFields
    }
    fragment UpdateFields on Mutation {
        updateProduct(input: $input) {
            id
            name
        }
    }
`;

const createAndUpdateProductDocument = gql`
    mutation CreateAndUpdate($create: CreateProductInput!, $update: UpdateProductInput!) {
        updateProduct(input: $update) {
            id
            name
        }
        createProduct(input: $create) {
            id
        }
    }
`;

describe('IdInterceptor field scope', () => {
    const { server, adminClient } = createTestEnvironment(mergeConfig(testConfig(), {}));

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

    it('decodes an ID selected through a named fragment', async () => {
        const { updateProduct } = await adminClient.query(updateProductNamedFragmentDocument, {
            input: {
                id: 'T_1',
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Renamed via fragment',
                        slug: 'laptop',
                        description: '',
                    },
                ],
            },
        });

        expect(updateProduct.id).toBe('T_1');
        expect(updateProduct.name).toBe('Renamed via fragment');
    });

    it('decodes an update ID when a sibling create reuses the argument name input', async () => {
        const { updateProduct, createProduct } = await adminClient.query(createAndUpdateProductDocument, {
            update: {
                id: 'T_1',
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Sibling rename',
                        slug: 'laptop',
                        description: '',
                    },
                ],
            },
            create: {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Sibling create',
                        slug: 'sibling-create-id-interceptor',
                        description: '',
                    },
                ],
            },
        });

        expect(updateProduct.id).toBe('T_1');
        expect(updateProduct.name).toBe('Sibling rename');
        expect(createProduct.id).toEqual(expect.any(String));
        expect(createProduct.id).not.toBe(updateProduct.id);
    });
});
