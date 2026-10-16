import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { createTestEnvironment } from '../../testing/lib/create-test-environment';

import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

// #5080 — input fields marked with `@nonBlank` reject empty and whitespace-only strings
describe('@nonBlank input fields', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

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

    it(
        'rejects a whitespace-only translation name',
        assertThrowsWithMessage(
            () =>
                adminClient.query(gql`
                    mutation {
                        createProduct(
                            input: { translations: [{ languageCode: en, name: "   ", slug: "blank-name" }] }
                        ) {
                            id
                        }
                    }
                `),
            'The "name" field cannot be blank',
        ),
    );

    it(
        'rejects a blank value in a nested input',
        assertThrowsWithMessage(
            () =>
                adminClient.query(gql`
                    mutation {
                        createFacet(
                            input: {
                                code: "nested"
                                isPrivate: false
                                translations: [{ languageCode: en, name: "Nested" }]
                                values: [{ code: "", translations: [{ languageCode: en, name: "Value" }] }]
                            }
                        ) {
                            id
                        }
                    }
                `),
            'The "code" field cannot be blank',
        ),
    );

    it(
        'rejects a blank value passed as a variable',
        assertThrowsWithMessage(
            () =>
                adminClient.query(
                    gql`
                        mutation ($input: CreateTagInput!) {
                            createTag(input: $input) {
                                id
                            }
                        }
                    `,
                    { input: { value: '' } },
                ),
            'The "value" field cannot be blank',
        ),
    );

    it('checks each aliased mutation against its own input type', async () => {
        const result = await adminClient.query(gql`
            mutation {
                a: createTaxCategory(input: { name: "Non-blank" }) {
                    name
                }
                b: createTag(input: { value: "non-blank" }) {
                    value
                }
            }
        `);
        expect(result).toEqual({ a: { name: 'Non-blank' }, b: { value: 'non-blank' } });
    });

    it('allows a partial update that omits the field', async () => {
        const { updateProduct } = await adminClient.query(gql`
            mutation {
                updateProduct(input: { id: "T_1", enabled: true }) {
                    id
                }
            }
        `);
        expect(updateProduct.id).toBe('T_1');
    });

    it(
        'rejects a blank value on the Shop API',
        assertThrowsWithMessage(
            () =>
                shopClient.query(gql`
                    mutation {
                        registerCustomerAccount(input: { emailAddress: " " }) {
                            __typename
                        }
                    }
                `),
            'The "emailAddress" field cannot be blank',
        ),
    );
});
