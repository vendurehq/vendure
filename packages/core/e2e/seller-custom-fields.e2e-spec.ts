import { DeletionResult, LanguageCode, SortOrder } from '@vendure/common/lib/generated-types';
import { mergeConfig, SellerTranslation, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { graphql as shopGraphql } from './graphql/graphql-shop';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

// The bootstrap creates this Seller before any translation rows exist. It is the
// "legacy row" case: a Seller from before this feature shipped.
const DEFAULT_SELLER_ID = 'T_1';

describe('Seller with localized custom fields', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Seller: [
                    { name: 'tagline', type: 'localeString' },
                    { name: 'description', type: 'localeText' },
                    { name: 'vatNumber', type: 'string' },
                ],
            },
        }),
    );

    let sellerId: string;
    let secondSellerId: string;
    let channelId: string;

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

    it('creates a seller with localized and plain custom fields', async () => {
        const { createSeller } = await adminClient.query(createSellerDocument, {
            input: {
                name: 'Fresh Foods',
                customFields: { vatNumber: 'DE123' },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        customFields: { tagline: 'Fresh every day', description: 'English description' },
                    },
                ],
            },
        });
        sellerId = createSeller.id;
        expect(createSeller.name).toBe('Fresh Foods');
        expect(createSeller.customFields).toEqual({
            tagline: 'Fresh every day',
            description: 'English description',
            vatNumber: 'DE123',
        });
        expect(createSeller.translations).toEqual([
            expect.objectContaining({
                languageCode: LanguageCode.en,
                customFields: { tagline: 'Fresh every day', description: 'English description' },
            }),
        ]);
    });

    it('creates a seller without translations', async () => {
        const { createSeller } = await adminClient.query(createSellerDocument, {
            input: { name: 'Plain Seller' },
        });
        secondSellerId = createSeller.id;
        expect(createSeller.name).toBe('Plain Seller');
        expect(createSeller.translations).toEqual([]);
        expect(createSeller.customFields.tagline).toBeNull();
        expect(createSeller.customFields.description).toBeNull();
    });

    it('adds a translation for another language', async () => {
        const { updateSeller } = await adminClient.query(
            updateSellerDocument,
            {
                input: {
                    id: sellerId,
                    translations: [
                        {
                            languageCode: LanguageCode.de,
                            customFields: {
                                tagline: 'Jeden Tag frisch',
                                description: 'Deutsche Beschreibung',
                            },
                        },
                    ],
                },
            },
            { languageCode: LanguageCode.de },
        );
        expect(updateSeller.customFields.tagline).toBe('Jeden Tag frisch');
        expect(updateSeller.customFields.description).toBe('Deutsche Beschreibung');
        // The plain field is stored on the Seller row and is the same in every language.
        expect(updateSeller.customFields.vatNumber).toBe('DE123');
        expect(updateSeller.translations.map(t => t.languageCode).sort()).toEqual([
            LanguageCode.de,
            LanguageCode.en,
        ]);
    });

    it('returns the custom fields in the requested language, falling back to the default', async () => {
        const en = await adminClient.query(
            getSellerDocument,
            { id: sellerId },
            { languageCode: LanguageCode.en },
        );
        expect(en.seller?.customFields.tagline).toBe('Fresh every day');

        const de = await adminClient.query(
            getSellerDocument,
            { id: sellerId },
            { languageCode: LanguageCode.de },
        );
        expect(de.seller?.customFields.tagline).toBe('Jeden Tag frisch');

        // zh has no translation, so the default language (en) is used.
        const zh = await adminClient.query(
            getSellerDocument,
            { id: sellerId },
            { languageCode: LanguageCode.zh },
        );
        expect(zh.seller?.customFields.tagline).toBe('Fresh every day');
        expect(zh.seller?.name).toBe('Fresh Foods');
    });

    it('updates a plain field and a localized field in one call', async () => {
        const { updateSeller } = await adminClient.query(updateSellerDocument, {
            input: {
                id: sellerId,
                customFields: { vatNumber: 'DE456' },
                translations: [
                    { languageCode: LanguageCode.en, customFields: { tagline: 'Fresher every day' } },
                ],
            },
        });
        expect(updateSeller.customFields.vatNumber).toBe('DE456');
        expect(updateSeller.customFields.tagline).toBe('Fresher every day');
        // Fields left out of the translation input keep their value.
        expect(updateSeller.customFields.description).toBe('English description');
    });

    it('reads a seller that has no translation rows', async () => {
        const { seller } = await adminClient.query(getSellerDocument, { id: DEFAULT_SELLER_ID });
        expect(seller?.name).toBe('Default Seller');
        expect(seller?.translations).toEqual([]);
        expect(seller?.customFields.tagline).toBeNull();
    });

    it('filters and sorts the seller list by a localized custom field', async () => {
        const filtered = await adminClient.query(
            getSellerListDocument,
            { options: { filter: { tagline: { contains: 'frisch' } } } },
            { languageCode: LanguageCode.de },
        );
        expect(filtered.sellers.items.map(s => s.name)).toEqual(['Fresh Foods']);

        // Two of the three sellers have no translation rows yet. Sorting on a localized field
        // must not drop them. Where NULL values sort differs per database, so only the count
        // and the set of names are asserted here; T11 asserts the order.
        const sorted = await adminClient.query(
            getSellerListDocument,
            { options: { sort: { tagline: SortOrder.ASC } } },
            { languageCode: LanguageCode.de },
        );
        expect(sorted.sellers.totalItems).toBe(3);
        expect(sorted.sellers.items.map(s => s.name).sort()).toEqual([
            'Default Seller',
            'Fresh Foods',
            'Plain Seller',
        ]);

        // Filtering and sorting on the same localized field in one query.
        const filteredAndSorted = await adminClient.query(
            getSellerListDocument,
            {
                options: {
                    filter: { tagline: { contains: 'frisch' } },
                    sort: { tagline: SortOrder.ASC },
                },
            },
            { languageCode: LanguageCode.de },
        );
        expect(filteredAndSorted.sellers.totalItems).toBe(1);
        expect(filteredAndSorted.sellers.items.map(s => s.name)).toEqual(['Fresh Foods']);
    });

    it('translates the seller in the createChannel response', async () => {
        const { createChannel } = await adminClient.query(
            createChannelWithSellerDocument,
            {
                input: {
                    code: 'fresh-foods-channel',
                    token: 'fresh-foods-token',
                    defaultLanguageCode: LanguageCode.en,
                    availableLanguageCodes: [LanguageCode.en, LanguageCode.de],
                    currencyCode: 'USD',
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                    sellerId,
                },
            },
            { languageCode: LanguageCode.de },
        );
        if (createChannel.__typename !== 'Channel') {
            throw new Error(`createChannel failed: ${createChannel.message}`);
        }
        channelId = createChannel.id;
        expect(createChannel.seller?.id).toBe(sellerId);
        expect(createChannel.seller?.customFields.tagline).toBe('Jeden Tag frisch');
    });

    it('translates the newly assigned seller in the updateChannel response', async () => {
        await adminClient.query(updateSellerDocument, {
            input: {
                id: secondSellerId,
                translations: [
                    { languageCode: LanguageCode.en, customFields: { tagline: 'Plain but proud' } },
                ],
            },
        });
        const { updateChannel } = await adminClient.query(updateChannelWithSellerDocument, {
            input: { id: channelId, sellerId: secondSellerId },
        });
        if (updateChannel.__typename !== 'Channel') {
            throw new Error(`updateChannel failed: ${updateChannel.message}`);
        }
        expect(updateChannel.seller?.id).toBe(secondSellerId);
        expect(updateChannel.seller?.customFields.tagline).toBe('Plain but proud');
    });

    it('exposes the translated custom fields through the shop API activeChannel', async () => {
        await adminClient.query(updateSellerDocument, {
            input: {
                id: DEFAULT_SELLER_ID,
                translations: [
                    { languageCode: LanguageCode.en, customFields: { tagline: 'Default in English' } },
                    { languageCode: LanguageCode.de, customFields: { tagline: 'Standard auf Deutsch' } },
                ],
            },
        });
        const en = await shopClient.query(activeChannelSellerDocument, {}, { languageCode: LanguageCode.en });
        expect(en.activeChannel.seller?.customFields.tagline).toBe('Default in English');

        const de = await shopClient.query(activeChannelSellerDocument, {}, { languageCode: LanguageCode.de });
        expect(de.activeChannel.seller?.customFields.tagline).toBe('Standard auf Deutsch');
    });

    it('orders the seller list by a localized custom field once every seller has a value', async () => {
        const { sellers } = await adminClient.query(
            getSellerListDocument,
            { options: { sort: { tagline: SortOrder.ASC } } },
            { languageCode: LanguageCode.en },
        );
        expect(sellers.items.map(s => s.customFields.tagline)).toEqual([
            'Default in English',
            'Fresher every day',
            'Plain but proud',
        ]);
    });

    it('updates the name without touching translations', async () => {
        const { updateSeller } = await adminClient.query(updateSellerDocument, {
            input: { id: secondSellerId, name: 'Plain Seller Renamed' },
        });
        expect(updateSeller.name).toBe('Plain Seller Renamed');
        // The localized value set earlier is untouched.
        expect(updateSeller.customFields.tagline).toBe('Plain but proud');
    });

    it('deletes a seller that has translation rows', async () => {
        const { createSeller } = await adminClient.query(createSellerDocument, {
            input: {
                name: 'Short Lived',
                translations: [{ languageCode: LanguageCode.en, customFields: { tagline: 'Here briefly' } }],
            },
        });
        const { deleteSeller } = await adminClient.query(deleteSellerDocument, { id: createSeller.id });
        expect(deleteSeller.result).toBe(DeletionResult.DELETED);
        const { seller } = await adminClient.query(getSellerDocument, { id: createSeller.id });
        expect(seller).toBeNull();

        // The foreign key removes the translation rows along with the seller.
        const connection = server.app.get(TransactionalConnection);
        const translations = await connection.rawConnection.getRepository(SellerTranslation).find();
        expect(translations.some(t => t.customFields.tagline === 'Here briefly')).toBe(false);
    });

    it(
        'updating an unknown id throws',
        assertThrowsWithMessage(
            () =>
                adminClient.query(updateSellerDocument, {
                    input: { id: 'T_999', name: 'Nobody' },
                }),
            'No Seller with the id "999" could be found',
        ),
    );

    it('creates no translation row when every localized value in the input is empty', async () => {
        const { createSeller } = await adminClient.query(createSellerDocument, {
            input: {
                name: 'Blank Row Seller',
                translations: [
                    { languageCode: LanguageCode.en, customFields: { tagline: '', description: '' } },
                ],
            },
        });

        expect(createSeller.translations).toEqual([]);
    });

    it('adds no translation row when every localized value in an update is empty', async () => {
        const { createSeller } = await adminClient.query(createSellerDocument, {
            input: { name: 'Rename Only Seller' },
        });

        const { updateSeller } = await adminClient.query(updateSellerDocument, {
            input: {
                id: createSeller.id,
                name: 'Renamed Seller',
                translations: [
                    { languageCode: LanguageCode.en, customFields: { tagline: null, description: null } },
                ],
            },
        });

        expect(updateSeller.name).toBe('Renamed Seller');
        expect(updateSeller.translations).toEqual([]);
    });
});

const sellerFieldsFragment = graphql(`
    fragment SellerWithCustomFields on Seller {
        id
        name
        customFields {
            tagline
            description
            vatNumber
        }
        translations {
            id
            languageCode
            customFields {
                tagline
                description
            }
        }
    }
`);

const createSellerDocument = graphql(
    `
        mutation CreateSellerWithCustomFields($input: CreateSellerInput!) {
            createSeller(input: $input) {
                ...SellerWithCustomFields
            }
        }
    `,
    [sellerFieldsFragment],
);

const updateSellerDocument = graphql(
    `
        mutation UpdateSellerWithCustomFields($input: UpdateSellerInput!) {
            updateSeller(input: $input) {
                ...SellerWithCustomFields
            }
        }
    `,
    [sellerFieldsFragment],
);

const getSellerDocument = graphql(
    `
        query GetSellerWithCustomFields($id: ID!) {
            seller(id: $id) {
                ...SellerWithCustomFields
            }
        }
    `,
    [sellerFieldsFragment],
);

const deleteSellerDocument = graphql(`
    mutation DeleteSellerWithCustomFields($id: ID!) {
        deleteSeller(id: $id) {
            result
            message
        }
    }
`);

const getSellerListDocument = graphql(`
    query GetSellerListWithCustomFields($options: SellerListOptions) {
        sellers(options: $options) {
            items {
                id
                name
                customFields {
                    tagline
                }
            }
            totalItems
        }
    }
`);

const createChannelWithSellerDocument = graphql(`
    mutation CreateChannelWithSeller($input: CreateChannelInput!) {
        createChannel(input: $input) {
            __typename
            ... on Channel {
                id
                seller {
                    id
                    customFields {
                        tagline
                    }
                }
            }
            ... on ErrorResult {
                message
            }
        }
    }
`);

const updateChannelWithSellerDocument = graphql(`
    mutation UpdateChannelWithSeller($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            __typename
            ... on Channel {
                id
                seller {
                    id
                    customFields {
                        tagline
                    }
                }
            }
            ... on ErrorResult {
                message
            }
        }
    }
`);

const activeChannelSellerDocument = shopGraphql(`
    query ActiveChannelSeller {
        activeChannel {
            id
            seller {
                id
                name
                customFields {
                    tagline
                }
            }
        }
    }
`);
