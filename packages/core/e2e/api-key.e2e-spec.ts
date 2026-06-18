import { DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER } from '@vendure/common/lib/shared-constants';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';

describe('ApiKey resolver', () => {
    const config = testConfig();
    config.authOptions.tokenMethod = ['cookie', 'bearer', 'api-key'];

    const { server, adminClient } = createTestEnvironment(config);
    const adminApiUrl = `http://localhost:${config.apiOptions.port}/${String(config.apiOptions.adminApiPath)}`;

    let createdApiKeyId: string;

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

    it('createApiKey', async ({ expect }) => {
        const result = await adminClient.query(CREATE_API_KEY, {
            input: {
                roleIds: ['1'],
                translations: [{ languageCode: LanguageCode.en, name: 'Test API Key' }],
            },
        });
        expect(result.createApiKey.apiKey).toBeDefined();
        createdApiKeyId = result.createApiKey.entityId;
    });

    it('apiKey', async ({ expect }) => {
        const result = await adminClient.query(API_KEY, { id: createdApiKeyId });
        expect(result.apiKey).toBeDefined();
        expect(result.apiKey?.id).toBe(createdApiKeyId);
        expect(result.apiKey?.name).toBe('Test API Key');
        expect(result.apiKey?.translations.find(t => t.languageCode === LanguageCode.en)).toBeDefined();
    });

    it('apiKeys', async ({ expect }) => {
        const result = await adminClient.query(API_KEYS);
        expect(result.apiKeys.items.length).toBeGreaterThan(0);
        expect(result.apiKeys.items.some((k: any) => k.id === createdApiKeyId)).toBe(true);
    });

    it('updateApiKey', async ({ expect }) => {
        const result = await adminClient.query(UPDATE_API_KEY, {
            input: {
                id: createdApiKeyId,
                // TODO roles
                translations: [
                    { languageCode: LanguageCode.en, name: 'Updated API Key' },
                    { languageCode: LanguageCode.de, name: 'Neuer Eintrag' },
                ],
            },
        });
        expect(result.updateApiKey.id).toBe(createdApiKeyId);
        expect(result.updateApiKey.name).toBe('Updated API Key');
        expect(result.updateApiKey.translations.find(t => t.languageCode === LanguageCode.de)?.name).toBe(
            'Neuer Eintrag',
        );
    });

    it('deleteApiKey', async ({ expect }) => {
        const result = await adminClient.query(DELETE_API_KEY, { ids: [createdApiKeyId] });
        expect(result.deleteApiKeys?.[0]?.result).toBe(DeletionResult.DELETED);
        // Should not be found anymore
        const { apiKey } = await adminClient.query(API_KEY, { id: createdApiKeyId });
        expect(apiKey).toBeNull();
    });

    it('rotateApiKey', async ({ expect }) => {
        const apiKey = await adminClient.query(CREATE_API_KEY, {
            input: {
                roleIds: ['1'],
                translations: [{ languageCode: LanguageCode.en, name: 'Test API Key' }],
            },
        });
        const result = await adminClient.query(ROTATE_API_KEY, { id: apiKey.createApiKey.entityId });
        expect(result.rotateApiKey.apiKey).toBeDefined();
        expect(apiKey.createApiKey.apiKey).not.toBe(result.rotateApiKey.apiKey);
    });

    it('API-Key usage life cycle: Read, Rotate, Delete', async ({ expect }) => {
        const { apiKey, entityId } = (
            await adminClient.query(CREATE_API_KEY, {
                input: {
                    roleIds: ['1'],
                    translations: [{ languageCode: LanguageCode.en, name: 'Test API Key' }],
                },
            })
        ).createApiKey;

        type _fetchResponse =
            | {
                  data?: { administrator?: { user?: { identifier?: string } } };
                  errors?: any[];
              }
            | undefined;

        const fetchConfig = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [String(config.authOptions.apiKeyHeaderKey)]: apiKey,
            },
            body: '{ "query": "query { administrator(id: 1) { user { identifier } } }" }',
        };

        // (1/4): Successfully read

        const readOk01 = (await fetch(adminApiUrl, fetchConfig).then(res => res.json())) as _fetchResponse;
        expect(readOk01?.data?.administrator?.user?.identifier).toBe(SUPER_ADMIN_USER_IDENTIFIER);

        // (2/4): Fail to read due to rotation of key

        const rotate = await adminClient.query(ROTATE_API_KEY, { id: entityId });
        const readErr01 = (await fetch(adminApiUrl, fetchConfig).then(res => res.json())) as _fetchResponse;
        expect(readErr01?.errors).toBeDefined();
        expect(readErr01?.data?.administrator?.user?.identifier).toBeUndefined();

        // (3/4): Successfully read via rotated key

        fetchConfig.headers[String(config.authOptions.apiKeyHeaderKey)] = rotate.rotateApiKey.apiKey;
        const readOk02 = (await fetch(adminApiUrl, fetchConfig).then(res => res.json())) as _fetchResponse;
        expect(readOk02?.data?.administrator?.user?.identifier).toBe(SUPER_ADMIN_USER_IDENTIFIER);

        // (4/4): Fail to read due to deletion

        const deletion = await adminClient.query(DELETE_API_KEY, { ids: [entityId] });
        expect(deletion.deleteApiKeys?.[0]?.result).toBe(DeletionResult.DELETED);

        const readErr02 = (await fetch(adminApiUrl, fetchConfig).then(res => res.json())) as _fetchResponse;
        expect(readErr02?.errors).toBeDefined();
        expect(readErr02?.data?.administrator?.user?.identifier).toBeUndefined();
    });
});

export const CREATE_API_KEY = graphql(`
    mutation CreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);

export const API_KEY = graphql(`
    query ApiKey($id: ID!) {
        apiKey(id: $id) {
            id
            name
            translations {
                id
                languageCode
                name
            }
        }
    }
`);

export const API_KEYS = graphql(`
    query ApiKeys($options: ApiKeyListOptions) {
        apiKeys(options: $options) {
            items {
                id
                name
            }
            totalItems
        }
    }
`);

export const UPDATE_API_KEY = graphql(`
    mutation UpdateApiKey($input: UpdateApiKeyInput!) {
        updateApiKey(input: $input) {
            id
            name
            translations {
                id
                languageCode
                name
            }
        }
    }
`);

export const DELETE_API_KEY = graphql(`
    mutation DeleteApiKey($ids: [ID!]!) {
        deleteApiKeys(ids: $ids) {
            result
            message
        }
    }
`);

export const ROTATE_API_KEY = graphql(`
    mutation RotateApiKey($id: ID!) {
        rotateApiKey(id: $id) {
            apiKey
        }
    }
`);
