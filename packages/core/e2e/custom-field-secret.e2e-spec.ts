import { LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { DefaultEncryptionStrategy, mergeConfig, TransactionalConnection } from '@vendure/core';
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

describe('secret custom fields', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Product: [
                    { name: 'secretKey', type: 'string', secret: true },
                    { name: 'note', type: 'string' },
                ],
            },
            systemOptions: {
                encryptionStrategy: new DefaultEncryptionStrategy({ secret: 'test-encryption-key' }),
            },
        }),
    );

    const manager = { emailAddress: 'cf-secret-manager@test.com', password: 'test-password' };

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
        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: manager.emailAddress,
                firstName: 'CF',
                lastName: 'Manager',
                password: manager.password,
                roleIds: [createRole.id],
            },
        });
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
        }, 'A value must be provided for the secret argument "secretKey"'),
    );
});
