import { LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    DefaultEncryptionStrategy,
    mergeConfig,
    RequestContext,
    SecretAccessInput,
    SecretAccessStrategy,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createAdministratorDocument, createRoleDocument } from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const GET_PRODUCT = gql`
    query GetProductSecret($id: ID!) {
        product(id: $id) {
            id
            customFields {
                secretKey
                note
            }
        }
    }
`;
const UPDATE_PRODUCT = gql`
    mutation UpdateProductSecret($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            customFields {
                secretKey
                note
            }
        }
    }
`;
const CREATE_PRODUCT = gql`
    mutation CreateProductSecret($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
            customFields {
                secretKey
                note
            }
        }
    }
`;

const PLAINTEXT_KEY = 'sk_live_customfield';

// Captures the input passed to the strategy so a test can assert the owning entity is provided,
// while preserving the default permission-based reveal decision.
let capturedSecretAccessInput: SecretAccessInput | undefined;
class CapturingSecretAccessStrategy implements SecretAccessStrategy {
    canAccessSecret(ctx: RequestContext, input: SecretAccessInput): boolean {
        capturedSecretAccessInput = input;
        return ctx.userHasPermissions([Permission.ReadSecret]);
    }
}

describe('secret custom fields', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Product: [
                    { name: 'secretKey', type: 'string', secret: true },
                    { name: 'note', type: 'string' },
                ],
                // This field has the same name as the Product secret field. With different names, the
                // sibling-field tests would pass even if the interceptor checked one mutation field's
                // arguments against a sibling field's input type.
                Administrator: [{ name: 'secretKey', type: 'string', secret: true }],
            },
            systemOptions: {
                encryptionStrategy: new DefaultEncryptionStrategy({ secret: 'test-encryption-key' }),
                secretAccessStrategy: new CapturingSecretAccessStrategy(),
            },
        }),
    );

    const manager = { emailAddress: 'cf-secret-manager@test.com', password: 'test-password' };
    let managerAdminId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        // A catalog manager who can read/update products but does NOT hold ReadSecret.
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'cf-secret-manager',
                description: 'Catalog manager',
                permissions: [Permission.ReadCatalog, Permission.CreateCatalog, Permission.UpdateCatalog],
                channelIds: ['T_1'],
            },
        });
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: manager.emailAddress,
                firstName: 'CF',
                lastName: 'Manager',
                password: manager.password,
                roleIds: [createRole.id],
            },
        });
        managerAdminId = createAdministrator.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a ReadSecret holder round-trips the plaintext value on update', async () => {
        await adminClient.asSuperAdmin();
        const { updateProduct } = await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { secretKey: PLAINTEXT_KEY, note: 'hello' } },
        });
        expect(updateProduct.customFields.secretKey).toBe(PLAINTEXT_KEY);
        expect(updateProduct.customFields.note).toBe('hello');
    });

    it('stores the secret custom field encrypted at rest', async () => {
        const connection = server.app.get(TransactionalConnection);
        const rows = await connection.rawConnection.query('SELECT * FROM product WHERE id = 1');
        const values = Object.values(rows[0] as Record<string, unknown>);
        expect(values.some(v => typeof v === 'string' && v.startsWith('enc:v1:'))).toBe(true);
        expect(values.some(v => v === PLAINTEXT_KEY)).toBe(false);
    });

    it('a non-ReadSecret admin gets the placeholder, but non-secret fields are visible', async () => {
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        const { product } = await adminClient.query(GET_PRODUCT, { id: 'T_1' });
        expect(product.customFields.secretKey).toBe(REDACTED_SECRET_PLACEHOLDER);
        expect(product.customFields.note).toBe('hello');
    });

    it('submitting the placeholder on update preserves the stored secret', async () => {
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER, note: 'updated' } },
        });
        await adminClient.asSuperAdmin();
        const { product } = await adminClient.query(GET_PRODUCT, { id: 'T_1' });
        expect(product.customFields.secretKey).toBe(PLAINTEXT_KEY);
        expect(product.customFields.note).toBe('updated');
    });

    it('submitting a new value on update replaces the stored secret', async () => {
        await adminClient.asSuperAdmin();
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { secretKey: 'sk_live_rotated' } },
        });
        const { product } = await adminClient.query(GET_PRODUCT, { id: 'T_1' });
        expect(product.customFields.secretKey).toBe('sk_live_rotated');
    });

    it('passes the owning entity (not the customFields wrapper) to the SecretAccessStrategy', async () => {
        await adminClient.asSuperAdmin();
        // Ensure the secret field holds a value, otherwise the resolver never invokes the strategy
        // and this test would pass vacuously regardless of what entity would have been passed.
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { secretKey: 'sk_entity_check' } },
        });
        capturedSecretAccessInput = undefined;
        await adminClient.query(GET_PRODUCT, { id: 'T_1' });
        const captured = capturedSecretAccessInput as SecretAccessInput | undefined;
        expect(captured?.kind).toBe('customField');
        const entity = captured?.kind === 'customField' ? captured.entity : undefined;
        // Must be the owning Product entity, not the customFields wrapper. The entity holds its custom
        // fields under a nested `customFields` object; the wrapper instead spreads them at the top
        // level (so it would have `secretKey` directly and no nested `customFields`).
        expect((entity as any)?.customFields?.secretKey).toBe('sk_entity_check');
        expect((entity as any)?.secretKey).toBeUndefined();
        expect(entity?.id).toBeTruthy();
    });

    // Gabriel review — secret custom fields on an entity edited via an alias input type (here
    // `updateActiveAdministrator`, an admin saving their own profile) must be preserved on a
    // placeholder resubmit, not corrupted. This is the common case that the Product-only suites missed.
    it('preserves a secret custom field edited via updateActiveAdministrator (alias input)', async () => {
        const SET_ADMIN_TOKEN = gql`
            mutation SetAdminToken($input: UpdateAdministratorInput!) {
                updateAdministrator(input: $input) {
                    id
                }
            }
        `;
        const GET_ADMIN_TOKEN = gql`
            query GetAdminToken($id: ID!) {
                administrator(id: $id) {
                    id
                    customFields {
                        secretKey
                    }
                }
            }
        `;
        const UPDATE_ACTIVE_ADMIN = gql`
            mutation UpdateActiveAdmin($input: UpdateActiveAdministratorInput!) {
                updateActiveAdministrator(input: $input) {
                    id
                }
            }
        `;
        // As SuperAdmin, set the manager's secret token.
        await adminClient.asSuperAdmin();
        await adminClient.query(SET_ADMIN_TOKEN, {
            input: { id: managerAdminId, customFields: { secretKey: 'admin_secret_token' } },
        });

        // The manager (no ReadSecret) sees the placeholder and saves their own profile back with it.
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        const { activeAdministrator } = await adminClient.query(gql`
            query {
                activeAdministrator {
                    id
                    customFields {
                        secretKey
                    }
                }
            }
        `);
        expect(activeAdministrator.customFields.secretKey).toBe(REDACTED_SECRET_PLACEHOLDER);
        await adminClient.query(UPDATE_ACTIVE_ADMIN, {
            input: { firstName: 'Renamed', customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER } },
        });

        // The stored secret must be preserved, not overwritten with the encrypted placeholder.
        await adminClient.asSuperAdmin();
        const { administrator } = await adminClient.query(GET_ADMIN_TOKEN, { id: managerAdminId });
        expect(administrator.customFields.secretKey).toBe('admin_secret_token');
    });

    it(
        'rejects the placeholder value on create',
        assertThrowsWithMessage(async () => {
            await adminClient.asSuperAdmin();
            await adminClient.query(CREATE_PRODUCT, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Secret Product',
                            slug: 'secret-product',
                            description: '',
                        },
                    ],
                    customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER },
                },
            });
        }, 'A value must be provided for the secret field "secretKey"'),
    );

    /**
     * `CustomFieldProcessingInterceptor` must check secret redaction placeholders against
     * the argument types of the mutation field being resolved. Otherwise a placeholder in an update
     * selected through a named or inline fragment is stored over the secret. A sibling create in the
     * same document makes an update placeholder fail validation. A sibling update placed before a
     * create deletes the create's placeholder, so the create succeeds with no secret instead of
     * failing validation.
     *
     * Several tests update the Administrator through `updateActiveAdministrator` because it takes no
     * ID argument. `IdInterceptor` does not decode the ID arguments of a field inside a named fragment
     * definition, or of a field placed before a sibling with an argument of the same name (#5511). An
     * `updateProduct` inside a named fragment, or placed before a sibling which also takes `input`,
     * receives the encoded ID and fails with "No Product with the id" before the secret handling runs.
     */
    describe('fragment-wrapped and multi-field mutations', () => {
        const GET_ADMINISTRATOR = gql`
            query GetAdministratorSecret($id: ID!) {
                administrator(id: $id) {
                    id
                    firstName
                    customFields {
                        secretKey
                    }
                }
            }
        `;
        const UPDATE_PRODUCT_INLINE_FRAGMENT = gql`
            mutation UpdateProductSecretInlineFragment($input: UpdateProductInput!) {
                ... on Mutation {
                    updateProduct(input: $input) {
                        id
                    }
                }
            }
        `;
        const UPDATE_ADMINISTRATOR = gql`
            mutation UpdateAdministratorSecret($input: UpdateAdministratorInput!) {
                updateAdministrator(input: $input) {
                    id
                }
            }
        `;
        const UPDATE_ACTIVE_ADMINISTRATOR_NAMED_FRAGMENT = gql`
            mutation UpdateActiveAdministratorSecretNamedFragment($input: UpdateActiveAdministratorInput!) {
                ...UpdateActiveAdministratorSecretFields
            }
            fragment UpdateActiveAdministratorSecretFields on Mutation {
                updateActiveAdministrator(input: $input) {
                    id
                }
            }
        `;
        const UPDATE_ACTIVE_ADMINISTRATOR_INLINE_FRAGMENT = gql`
            mutation UpdateActiveAdministratorSecretInlineFragment($input: UpdateActiveAdministratorInput!) {
                ... on Mutation {
                    updateActiveAdministrator(input: $input) {
                        id
                    }
                }
            }
        `;
        const CREATE_PRODUCT_NAMED_FRAGMENT = gql`
            mutation CreateProductSecretNamedFragment($input: CreateProductInput!) {
                ...CreateProductSecretFields
            }
            fragment CreateProductSecretFields on Mutation {
                createProduct(input: $input) {
                    id
                }
            }
        `;
        const CREATE_PRODUCT_INLINE_FRAGMENT = gql`
            mutation CreateProductSecretInlineFragment($input: CreateProductInput!) {
                ... on Mutation {
                    createProduct(input: $input) {
                        id
                    }
                }
            }
        `;
        const CREATE_PRODUCT_THEN_UPDATE_PRODUCT = gql`
            mutation CreateThenUpdateProductSecret(
                $create: CreateProductInput!
                $update: UpdateProductInput!
            ) {
                createProduct(input: $create) {
                    id
                }
                updateProduct(input: $update) {
                    id
                }
            }
        `;
        const CREATE_PRODUCT_THEN_UPDATE_ACTIVE_ADMINISTRATOR = gql`
            mutation CreateProductThenUpdateActiveAdministratorSecret(
                $create: CreateProductInput!
                $update: UpdateActiveAdministratorInput!
            ) {
                createProduct(input: $create) {
                    id
                }
                updateActiveAdministrator(input: $update) {
                    id
                }
            }
        `;
        const UPDATE_ACTIVE_ADMINISTRATOR_THEN_CREATE_PRODUCT = gql`
            mutation UpdateActiveAdministratorThenCreateProductSecret(
                $create: CreateProductInput!
                $update: UpdateActiveAdministratorInput!
            ) {
                updateActiveAdministrator(input: $update) {
                    id
                }
                createProduct(input: $create) {
                    id
                }
            }
        `;

        const PRODUCT_SECRET = 'sk_live_product';
        const ADMIN_SECRET = 'sk_live_admin';
        const SECRET_REQUIRED_MESSAGE = 'A value must be provided for the secret field "secretKey"';
        let slugCounter = 0;

        function createProductInput(secretKey: string) {
            const slug = `secret-ops-product-${++slugCounter}`;
            return {
                translations: [{ languageCode: LanguageCode.en, name: slug, slug, description: '' }],
                customFields: { secretKey },
            };
        }

        async function getStoredProduct(id: string): Promise<{ secretKey: string; note: string }> {
            await adminClient.asSuperAdmin();
            const { product } = await adminClient.query(GET_PRODUCT, { id });
            return product.customFields;
        }

        async function getStoredAdministrator(): Promise<{ firstName: string; secretKey: string }> {
            await adminClient.asSuperAdmin();
            const { administrator } = await adminClient.query(GET_ADMINISTRATOR, { id: managerAdminId });
            return { firstName: administrator.firstName, secretKey: administrator.customFields.secretKey };
        }

        async function resetStoredSecrets() {
            await adminClient.asSuperAdmin();
            await adminClient.query(UPDATE_PRODUCT, {
                input: { id: 'T_1', customFields: { secretKey: PRODUCT_SECRET, note: null } },
            });
            await adminClient.query(UPDATE_ADMINISTRATOR, {
                input: { id: managerAdminId, firstName: 'CF', customFields: { secretKey: ADMIN_SECRET } },
            });
        }

        async function asManager() {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        }

        beforeAll(async () => {
            await resetStoredSecrets();
        });

        describe('updates submitting the placeholder preserve the stored secret', () => {
            it('inline-fragment updateProduct', async () => {
                await asManager();
                await adminClient.query(UPDATE_PRODUCT_INLINE_FRAGMENT, {
                    input: {
                        id: 'T_1',
                        customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER, note: 'inline' },
                    },
                });
                expect(await getStoredProduct('T_1')).toEqual({ secretKey: PRODUCT_SECRET, note: 'inline' });
            });

            it('named-fragment updateActiveAdministrator', async () => {
                await asManager();
                await adminClient.query(UPDATE_ACTIVE_ADMINISTRATOR_NAMED_FRAGMENT, {
                    input: { firstName: 'Named', customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER } },
                });
                expect(await getStoredAdministrator()).toEqual({
                    firstName: 'Named',
                    secretKey: ADMIN_SECRET,
                });
            });

            it('inline-fragment updateActiveAdministrator', async () => {
                await asManager();
                await adminClient.query(UPDATE_ACTIVE_ADMINISTRATOR_INLINE_FRAGMENT, {
                    input: { firstName: 'Inline', customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER } },
                });
                expect(await getStoredAdministrator()).toEqual({
                    firstName: 'Inline',
                    secretKey: ADMIN_SECRET,
                });
            });
        });

        describe('updates submitting an explicit value replace the stored secret', () => {
            afterAll(async () => {
                await resetStoredSecrets();
            });

            it('inline-fragment updateProduct', async () => {
                await asManager();
                await adminClient.query(UPDATE_PRODUCT_INLINE_FRAGMENT, {
                    input: { id: 'T_1', customFields: { secretKey: 'sk_live_inline_rotated' } },
                });
                expect((await getStoredProduct('T_1')).secretKey).toBe('sk_live_inline_rotated');
            });

            it('named-fragment updateActiveAdministrator', async () => {
                await asManager();
                await adminClient.query(UPDATE_ACTIVE_ADMINISTRATOR_NAMED_FRAGMENT, {
                    input: { customFields: { secretKey: 'sk_live_named_rotated' } },
                });
                expect((await getStoredAdministrator()).secretKey).toBe('sk_live_named_rotated');
            });
        });

        describe('creates', () => {
            it(
                'named-fragment createProduct rejects the placeholder',
                assertThrowsWithMessage(async () => {
                    await asManager();
                    await adminClient.query(CREATE_PRODUCT_NAMED_FRAGMENT, {
                        input: createProductInput(REDACTED_SECRET_PLACEHOLDER),
                    });
                }, SECRET_REQUIRED_MESSAGE),
            );

            it(
                'inline-fragment createProduct rejects the placeholder',
                assertThrowsWithMessage(async () => {
                    await asManager();
                    await adminClient.query(CREATE_PRODUCT_INLINE_FRAGMENT, {
                        input: createProductInput(REDACTED_SECRET_PLACEHOLDER),
                    });
                }, SECRET_REQUIRED_MESSAGE),
            );

            it('named-fragment createProduct with an explicit value stores the secret', async () => {
                await asManager();
                const { createProduct } = await adminClient.query(CREATE_PRODUCT_NAMED_FRAGMENT, {
                    input: createProductInput('sk_live_created'),
                });
                expect((await getStoredProduct(createProduct.id)).secretKey).toBe('sk_live_created');
            });
        });

        describe('sibling create and update fields do not affect each other', () => {
            beforeAll(async () => {
                await resetStoredSecrets();
            });

            it('createProduct then updateProduct: the update placeholder is preserved', async () => {
                await asManager();
                const { createProduct, updateProduct } = await adminClient.query(
                    CREATE_PRODUCT_THEN_UPDATE_PRODUCT,
                    {
                        create: createProductInput('sk_live_sibling_a'),
                        update: {
                            id: 'T_1',
                            customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER, note: 'sibling-a' },
                        },
                    },
                );
                expect(updateProduct.id).toBe('T_1');
                expect(await getStoredProduct('T_1')).toEqual({
                    secretKey: PRODUCT_SECRET,
                    note: 'sibling-a',
                });
                expect((await getStoredProduct(createProduct.id)).secretKey).toBe('sk_live_sibling_a');
            });

            it('createProduct then updateActiveAdministrator: the update placeholder is preserved', async () => {
                await asManager();
                const { createProduct } = await adminClient.query(
                    CREATE_PRODUCT_THEN_UPDATE_ACTIVE_ADMINISTRATOR,
                    {
                        create: createProductInput('sk_live_sibling_b'),
                        update: {
                            firstName: 'SiblingB',
                            customFields: { secretKey: REDACTED_SECRET_PLACEHOLDER },
                        },
                    },
                );
                expect(await getStoredAdministrator()).toEqual({
                    firstName: 'SiblingB',
                    secretKey: ADMIN_SECRET,
                });
                expect((await getStoredProduct(createProduct.id)).secretKey).toBe('sk_live_sibling_b');
            });

            it('updateActiveAdministrator then createProduct: the create placeholder is still rejected', async () => {
                await assertThrowsWithMessage(async () => {
                    await asManager();
                    await adminClient.query(UPDATE_ACTIVE_ADMINISTRATOR_THEN_CREATE_PRODUCT, {
                        create: createProductInput(REDACTED_SECRET_PLACEHOLDER),
                        update: { firstName: 'SiblingC' },
                    });
                }, SECRET_REQUIRED_MESSAGE)();
                expect((await getStoredAdministrator()).secretKey).toBe(ADMIN_SECRET);
            });

            it('createProduct then updateProduct: the create placeholder is still rejected', async () => {
                await assertThrowsWithMessage(async () => {
                    await asManager();
                    await adminClient.query(CREATE_PRODUCT_THEN_UPDATE_PRODUCT, {
                        create: createProductInput(REDACTED_SECRET_PLACEHOLDER),
                        update: { id: 'T_1', customFields: { note: 'sibling-d' } },
                    });
                }, SECRET_REQUIRED_MESSAGE)();
                expect((await getStoredProduct('T_1')).secretKey).toBe(PRODUCT_SECRET);
            });
        });
    });
});
