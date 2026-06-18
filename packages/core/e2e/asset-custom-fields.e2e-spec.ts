import { LanguageCode } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';

describe('Asset with translatable custom fields', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Asset: [
                    { name: 'alt', type: 'localeString' as const },
                    { name: 'title', type: 'localeString' as const },
                ],
            },
        }),
    );

    let assetId: string;

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

    it('creates an asset with translatable custom fields', async () => {
        const filesToUpload = [path.join(__dirname, 'fixtures/assets/pps1.jpg')];
        const { createAssets } = await adminClient.fileUploadMutation({
            mutation: createAssetsWithCustomFieldsDocument,
            filePaths: filesToUpload,
            mapVariables: filePaths => ({
                input: filePaths.map(p => ({
                    file: null,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'pps1.jpg',
                            customFields: {
                                alt: 'Default alt text',
                                title: 'Default title',
                            },
                        },
                    ],
                })),
            }),
        });

        expect(createAssets.length).toBe(1);
        const asset = createAssets[0];
        expect(asset).toHaveProperty('name', 'pps1.jpg');
        expect(asset).toHaveProperty('customFields');
        expect(asset.customFields.alt).toBe('Default alt text');
        expect(asset.customFields.title).toBe('Default title');

        assetId = asset.id;
    });

    it('updates asset with English translations', async () => {
        const { updateAsset } = await adminClient.query(updateAssetWithCustomFieldsDocument, {
            input: {
                id: assetId,
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        customFields: {
                            alt: 'English alt text',
                            title: 'English title',
                        },
                    },
                ],
            },
        });

        expect(updateAsset.customFields.alt).toBe('English alt text');
        expect(updateAsset.customFields.title).toBe('English title');
    });

    it('updates asset with German translations', async () => {
        const { updateAsset } = await adminClient.query(
            updateAssetWithCustomFieldsDocument,
            {
                input: {
                    id: assetId,
                    translations: [
                        {
                            languageCode: LanguageCode.de,
                            name: 'pps1.jpg',
                            customFields: {
                                alt: 'German alt text',
                                title: 'German title',
                            },
                        },
                    ],
                },
            },
            { languageCode: LanguageCode.de },
        );

        expect(updateAsset.customFields.alt).toBe('German alt text');
        expect(updateAsset.customFields.title).toBe('German title');
    });

    it('retrieves English translations when querying in English', async () => {
        const { asset } = await adminClient.query(
            getAssetWithCustomFieldsDocument,
            { id: assetId },
            { languageCode: LanguageCode.en },
        );

        expect(asset).not.toBeNull();
        if (asset) {
            expect(asset.customFields.alt).toBe('English alt text');
            expect(asset.customFields.title).toBe('English title');
        }
    });

    it('retrieves German translations when querying in German', async () => {
        const { asset } = await adminClient.query(
            getAssetWithCustomFieldsDocument,
            { id: assetId },
            { languageCode: LanguageCode.de },
        );

        expect(asset).not.toBeNull();
        if (asset) {
            expect(asset.customFields.alt).toBe('German alt text');
            expect(asset.customFields.title).toBe('German title');
        }
    });

    it('falls back to default language when translation is not available', async () => {
        const { asset } = await adminClient.query(
            getAssetWithCustomFieldsDocument,
            { id: assetId },
            { languageCode: LanguageCode.zh },
        );

        expect(asset).not.toBeNull();
        if (asset) {
            // Should fall back to English (the default language)
            expect(asset.customFields.alt).toBe('English alt text');
            expect(asset.customFields.title).toBe('English title');
        }
    });
});

const createAssetsWithCustomFieldsDocument = graphql(`
    mutation CreateAssetsWithCustomFields($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            ... on Asset {
                id
                name
                customFields {
                    alt
                    title
                }
            }
            ... on MimeTypeError {
                message
                fileName
                mimeType
            }
        }
    }
`);

const updateAssetWithCustomFieldsDocument = graphql(`
    mutation UpdateAssetWithCustomFields($input: UpdateAssetInput!) {
        updateAsset(input: $input) {
            id
            name
            customFields {
                alt
                title
            }
        }
    }
`);

const getAssetWithCustomFieldsDocument = graphql(`
    query GetAssetWithCustomFields($id: ID!) {
        asset(id: $id) {
            id
            name
            customFields {
                alt
                title
            }
        }
    }
`);
