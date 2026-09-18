import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { getTagListDocument, createTagDocument, createTaxCategoryDocument } from './graphql/admin-definitions';
import {
    createChannelDocument,
    createFacetDocument,
    createFacetValueDocument,
    createProductDocument,
    createProductVariantsDocument,
    createZoneDocument,
    multiFieldMutationDocument,
    updateChannelDocument,
    updateFacetDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { registerAccountDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('Required field validation', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('Product', () => {
        it('rejects empty name', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            { languageCode: LanguageCode.en, name: '', slug: 's', description: 'd' },
                        ],
                    },
                });
            }, 'The "name" field cannot be blank')();
        });

        it('rejects empty slug', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            { languageCode: LanguageCode.en, name: 'N', slug: '', description: 'd' },
                        ],
                    },
                });
            }, 'The "slug" field cannot be blank')();
        });

        it('rejects whitespace-only name', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            { languageCode: LanguageCode.en, name: '   ', slug: 's', description: 'd' },
                        ],
                    },
                });
            }, 'The "name" field cannot be blank')();
        });

        it('accepts valid input', async () => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Test Product', slug: 'test-product', description: 'A product' },
                    ],
                },
            });
            expect(result.createProduct.name).toBe('Test Product');
        });

        it('rejects blank name on update', async () => {
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        { languageCode: LanguageCode.en, name: 'To Update', slug: 'to-update', description: 'd' },
                    ],
                },
            });
            await assertThrowsWithMessage(async () => {
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: createProduct.id,
                        translations: [{ languageCode: LanguageCode.en, name: '' }],
                    },
                });
            }, 'The "name" field cannot be blank')();
        });
    });

    describe('ProductVariant', () => {
        const makeProduct = async (name: string, slug: string) => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    translations: [{ languageCode: LanguageCode.en, name, slug, description: 'd' }],
                },
            });
            return result.createProduct;
        };

        it('rejects empty sku', async () => {
            const product = await makeProduct('PV Sku Test', 'pv-sku-test');
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: product.id,
                            sku: '',
                            translations: [{ languageCode: LanguageCode.en, name: 'V' }],
                        },
                    ],
                });
            }, 'The "sku" field cannot be blank')();
        });

        it('rejects whitespace-only sku', async () => {
            const product = await makeProduct('PV Ws', 'pv-ws');
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: product.id,
                            sku: '   ',
                            translations: [{ languageCode: LanguageCode.en, name: 'V' }],
                        },
                    ],
                });
            }, 'The "sku" field cannot be blank')();
        });

        it('rejects empty translation name', async () => {
            const product = await makeProduct('PV Name', 'pv-name');
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: product.id,
                            sku: 'SKU-1',
                            translations: [{ languageCode: LanguageCode.en, name: '' }],
                        },
                    ],
                });
            }, 'The "name" field cannot be blank')();
        });

        it('accepts padded non-blank values', async () => {
            const product = await makeProduct('PV Pad', 'pv-pad');
            const result = await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId: product.id,
                        sku: ' padded-sku ',
                        translations: [{ languageCode: LanguageCode.en, name: ' Padded Variant ' }],
                    },
                ],
            });
            expect(result.createProductVariants[0].sku).toBe(' padded-sku ');
        });
    });

    describe('Facet', () => {
        it('rejects empty code', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createFacetDocument, {
                    input: { code: '', translations: [{ languageCode: LanguageCode.en, name: 'F' }], isPrivate: false },
                });
            }, 'The "code" field cannot be blank')();
        });

        it('rejects empty translation name', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createFacetDocument, {
                    input: { code: 'f-code', translations: [{ languageCode: LanguageCode.en, name: '' }], isPrivate: false },
                });
            }, 'The "name" field cannot be blank')();
        });

        it('rejects whitespace-only code', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createFacetDocument, {
                    input: { code: '   ', translations: [{ languageCode: LanguageCode.en, name: 'F' }], isPrivate: false },
                });
            }, 'The "code" field cannot be blank')();
        });

        it('accepts valid input', async () => {
            const result = await adminClient.query(createFacetDocument, {
                input: { code: 'valid-facet', translations: [{ languageCode: LanguageCode.en, name: 'Valid Facet' }], isPrivate: false },
            });
            expect(result.createFacet.code).toBe('valid-facet');
        });
    });

    describe('FacetValue', () => {
        it('rejects empty code', async () => {
            const facet = await adminClient.query(createFacetDocument, {
                input: { code: 'fv-parent', translations: [{ languageCode: LanguageCode.en, name: 'FV Parent' }], isPrivate: false },
            });
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createFacetValueDocument, {
                    input: { facetId: facet.createFacet.id, code: '', translations: [{ languageCode: LanguageCode.en, name: 'V' }] },
                });
            }, 'The "code" field cannot be blank')();
        });

        it('rejects empty translation name', async () => {
            const facet = await adminClient.query(createFacetDocument, {
                input: { code: 'fv-parent2', translations: [{ languageCode: LanguageCode.en, name: 'FV Parent 2' }], isPrivate: false },
            });
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createFacetValueDocument, {
                    input: { facetId: facet.createFacet.id, code: 'fv-code', translations: [{ languageCode: LanguageCode.en, name: '' }] },
                });
            }, 'The "name" field cannot be blank')();
        });
    });

    describe('Facet nested input — out of scope', () => {
        // Nested input types (e.g. CreateFacetValueWithFacetInput inside CreateFacetInput.values)
        // are not validated by this interceptor. They should be validated in the service layer.
        it.todo('createFacet with blank nested values[0].code should be validated in the service layer');
    });

    describe('Channel', () => {
        const channelInput = {
            defaultLanguageCode: LanguageCode.en,
            pricesIncludeTax: false,
            currencyCode: CurrencyCode.USD,
            defaultTaxZoneId: 'T_1',
            defaultShippingZoneId: 'T_1',
        };

        it('rejects empty code', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createChannelDocument, {
                    input: { ...channelInput, code: '', token: 'some-token' },
                });
            }, 'The "code" field cannot be blank')();
        });

        it('rejects empty token', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createChannelDocument, {
                    input: { ...channelInput, code: 'test-channel', token: '' },
                });
            }, 'The "token" field cannot be blank')();
        });

        it('rejects whitespace-only token', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createChannelDocument, {
                    input: { ...channelInput, code: 'test-channel-2', token: '   ' },
                });
            }, 'The "token" field cannot be blank')();
        });

        it('accepts valid input', async () => {
            const result = await adminClient.query(createChannelDocument, {
                input: { ...channelInput, code: 'valid-channel', token: 'valid-token' },
            });
            expect(result.createChannel.code).toBe('valid-channel');
        });

        it('rejects blank code on update', async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: { ...channelInput, code: 'upd-channel', token: 'upd-token' },
            });
            await assertThrowsWithMessage(async () => {
                await adminClient.query(updateChannelDocument, {
                    input: { id: createChannel.id, code: '' },
                });
            }, 'The "code" field cannot be blank')();
        });

        it('rejects blank token on update', async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: { ...channelInput, code: 'upd-channel-2', token: 'upd-token-2' },
            });
            await assertThrowsWithMessage(async () => {
                await adminClient.query(updateChannelDocument, {
                    input: { id: createChannel.id, token: '' },
                });
            }, 'The "token" field cannot be blank')();
        });
    });

    describe('Zone', () => {
        it('rejects empty name', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createZoneDocument, { input: { name: '' } });
            }, 'The "name" field cannot be blank')();
        });

        it('rejects whitespace-only name', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createZoneDocument, { input: { name: '   ' } });
            }, 'The "name" field cannot be blank')();
        });

        it('accepts valid name', async () => {
            const result = await adminClient.query(createZoneDocument, { input: { name: 'Test Zone' } });
            expect(result.createZone.name).toBe('Test Zone');
        });
    });

    describe('Tag', () => {
        it('rejects empty value', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createTagDocument, { input: { value: '' } });
            }, 'The "value" field cannot be blank')();
        });

        it('rejects whitespace-only value', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createTagDocument, { input: { value: '   ' } });
            }, 'The "value" field cannot be blank')();
        });

        it('accepts valid value', async () => {
            const result = await adminClient.query(createTagDocument, {
                input: { value: 'test-tag' },
            });
            expect(result.createTag.value).toBe('test-tag');
        });
    });

    describe('TaxCategory', () => {
        it('rejects empty name', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createTaxCategoryDocument, { input: { name: '' } });
            }, 'The "name" field cannot be blank')();
        });

        it('accepts valid name', async () => {
            const result = await adminClient.query(createTaxCategoryDocument, {
                input: { name: 'Test Tax Category' },
            });
            expect(result.createTaxCategory.name).toBe('Test Tax Category');
        });
    });

    describe('Shop API — RegisterCustomerInput', () => {
        it('rejects empty emailAddress', async () => {
            await assertThrowsWithMessage(async () => {
                await shopClient.query(registerAccountDocument, {
                    input: { emailAddress: '', password: 'test123' },
                });
            }, 'The "emailAddress" field cannot be blank')();
        });

        it('rejects whitespace-only emailAddress', async () => {
            await assertThrowsWithMessage(async () => {
                await shopClient.query(registerAccountDocument, {
                    input: { emailAddress: '   ', password: 'test123' },
                });
            }, 'The "emailAddress" field cannot be blank')();
        });
    });

    describe('Write did not happen', () => {
        it('rejected creation does not increase entity count', async () => {
            const before = await adminClient.query(getTagListDocument, { options: { take: 1 } });
            await assertThrowsWithMessage(async () => {
                await adminClient.query(createTagDocument, { input: { value: '' } });
            }, 'The "value" field cannot be blank')();
            const after = await adminClient.query(getTagListDocument, { options: { take: 1 } });
            expect(after.tags.totalItems).toBe(before.tags.totalItems);
        });
    });

    describe('Multi-field mutation', () => {
        it('validates each field against its own input type when argument names collide', async () => {
            // Both createFacet and createChannel take `input` as their argument name.
            // The interceptor must resolve each field's argument type from the schema,
            // not from a flat map of argument names across the operation.
            await assertThrowsWithMessage(async () => {
                await adminClient.query(multiFieldMutationDocument, {
                    facet: {
                        code: 'multi-facet',
                        translations: [{ languageCode: LanguageCode.en, name: 'Multi' }],
                        isPrivate: false,
                    },
                    channel: {
                        code: 'multi-channel',
                        token: '', // blank — should be caught by ChannelInput spec, not FacetInput spec
                        defaultLanguageCode: LanguageCode.en,
                        pricesIncludeTax: false,
                        currencyCode: CurrencyCode.USD,
                        defaultTaxZoneId: 'T_1',
                        defaultShippingZoneId: 'T_1',
                    },
                });
            }, 'The "token" field cannot be blank')();
        });
    });
});
