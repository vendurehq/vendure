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

    it(
        'checks each aliased mutation against its own input type',
        assertThrowsWithMessage(
            () =>
                adminClient.query(gql`
                    mutation {
                        a: createTaxCategory(input: { name: "Non-blank" }) {
                            name
                        }
                        b: createTag(input: { value: " " }) {
                            value
                        }
                    }
                `),
            'The "value" field cannot be blank',
        ),
    );

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

    // #5080 - the examples from the issue report
    describe('fields listed in #5080', () => {
        it(
            'rejects updateFacet with an empty code',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(gql`
                        mutation {
                            updateFacet(input: { id: "T_1", code: "" }) {
                                id
                            }
                        }
                    `),
                'The "code" field cannot be blank',
            ),
        );

        it(
            'rejects updateProductVariants with a whitespace-only sku',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(gql`
                        mutation {
                            updateProductVariants(input: [{ id: "T_1", sku: "   " }]) {
                                id
                            }
                        }
                    `),
                'The "sku" field cannot be blank',
            ),
        );

        it('rejects updateChannel with an empty token', async () => {
            const { createChannel } = await adminClient.query(gql`
                mutation {
                    createChannel(
                        input: {
                            code: "channel-5080"
                            token: "token-5080"
                            defaultLanguageCode: en
                            defaultCurrencyCode: USD
                            pricesIncludeTax: false
                            defaultShippingZoneId: "T_1"
                            defaultTaxZoneId: "T_1"
                        }
                    ) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `);
            await assertThrowsWithMessage(
                () =>
                    adminClient.query(
                        gql`
                            mutation ($id: ID!) {
                                updateChannel(input: { id: $id, token: "" }) {
                                    ... on Channel {
                                        id
                                    }
                                }
                            }
                        `,
                        { id: createChannel.id },
                    ),
                'The "token" field cannot be blank',
            )();
        });

        it(
            'rejects createAdministrator with an empty lastName',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(gql`
                        mutation {
                            createAdministrator(
                                input: {
                                    firstName: "Blank"
                                    lastName: ""
                                    emailAddress: "blank-5080@test.com"
                                    password: "test"
                                    roleIds: ["1"]
                                }
                            ) {
                                id
                            }
                        }
                    `),
                'The "lastName" field cannot be blank',
            ),
        );

        it('rejects setCustomerForOrder with an empty lastName on the Shop API', async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(gql`
                mutation {
                    addItemToOrder(productVariantId: "T_1", quantity: 1) {
                        ... on Order {
                            id
                        }
                    }
                }
            `);
            await assertThrowsWithMessage(
                () =>
                    shopClient.query(gql`
                        mutation {
                            setCustomerForOrder(
                                input: {
                                    firstName: "Blank"
                                    lastName: ""
                                    emailAddress: "shop-5080@test.com"
                                }
                            ) {
                                ... on Order {
                                    id
                                }
                            }
                        }
                    `),
                'The "lastName" field cannot be blank',
            )();
        });

        it('accepts an empty description, which is not marked with @nonBlank', async () => {
            const { createCollection } = await adminClient.query(gql`
                mutation {
                    createCollection(
                        input: {
                            filters: []
                            translations: [
                                {
                                    languageCode: en
                                    name: "Empty description"
                                    slug: "empty-desc-5080"
                                    description: ""
                                }
                            ]
                        }
                    ) {
                        name
                        description
                    }
                }
            `);
            expect(createCollection).toEqual({ name: 'Empty description', description: '' });
        });

        it('keeps a customer who registered without a name editable', async () => {
            const emailAddress = 'registered-no-name-5080@test.com';
            await shopClient.asAnonymousUser();
            const { registerCustomerAccount } = await shopClient.query(
                gql`
                    mutation ($input: RegisterCustomerInput!) {
                        registerCustomerAccount(input: $input) {
                            __typename
                        }
                    }
                `,
                { input: { emailAddress, password: 'test' } },
            );
            expect(registerCustomerAccount.__typename).toBe('Success');
            const { customers } = await adminClient.query(
                gql`
                    query ($email: String!) {
                        customers(options: { filter: { emailAddress: { eq: $email } } }) {
                            items {
                                id
                                firstName
                                lastName
                            }
                        }
                    }
                `,
                { email: emailAddress },
            );
            const customer = customers.items[0];
            expect(customer).toMatchObject({ firstName: '', lastName: '' });

            const updateCustomer = gql`
                mutation ($input: UpdateCustomerInput!) {
                    updateCustomer(input: $input) {
                        ... on Customer {
                            phoneNumber
                        }
                    }
                }
            `;
            // Only the phone number, as an API client would send it
            const phoneOnly = await adminClient.query(updateCustomer, {
                input: { id: customer.id, phoneNumber: '+43 1' },
            });
            expect(phoneOnly.updateCustomer.phoneNumber).toBe('+43 1');
            // Every field, as the Dashboard customer form sends it
            const fullForm = await adminClient.query(updateCustomer, {
                input: { id: customer.id, firstName: '', lastName: '', phoneNumber: '+43 2', emailAddress },
            });
            expect(fullForm.updateCustomer.phoneNumber).toBe('+43 2');

            await assertThrowsWithMessage(
                () => adminClient.query(updateCustomer, { input: { id: customer.id, emailAddress: ' ' } }),
                'The "emailAddress" field cannot be blank',
            )();
        });

        it('leaves the stored values unchanged after the rejected mutations', async () => {
            const { facet, productVariant } = await adminClient.query(gql`
                query {
                    facet(id: "T_1") {
                        code
                    }
                    productVariant(id: "T_1") {
                        sku
                    }
                }
            `);
            expect(facet.code.trim()).not.toBe('');
            expect(productVariant.sku.trim()).not.toBe('');
        });
    });
});
