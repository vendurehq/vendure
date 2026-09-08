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
                Administrator: [{ name: 'apiToken', type: 'string', secret: true }],
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
                        apiToken
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
            input: { id: managerAdminId, customFields: { apiToken: 'admin_secret_token' } },
        });

        // The manager (no ReadSecret) sees the placeholder and saves their own profile back with it.
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        const { activeAdministrator } = await adminClient.query(gql`
            query {
                activeAdministrator {
                    id
                    customFields {
                        apiToken
                    }
                }
            }
        `);
        expect(activeAdministrator.customFields.apiToken).toBe(REDACTED_SECRET_PLACEHOLDER);
        await adminClient.query(UPDATE_ACTIVE_ADMIN, {
            input: { firstName: 'Renamed', customFields: { apiToken: REDACTED_SECRET_PLACEHOLDER } },
        });

        // The stored secret must be preserved, not overwritten with the encrypted placeholder.
        await adminClient.asSuperAdmin();
        const { administrator } = await adminClient.query(GET_ADMIN_TOKEN, { id: managerAdminId });
        expect(administrator.customFields.apiToken).toBe('admin_secret_token');
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
});
