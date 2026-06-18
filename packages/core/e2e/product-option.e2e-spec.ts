import { CurrencyCode, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { omit } from '../../common/lib/omit';

import { channelFragment, productOptionGroupFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';
import {
    addOptionGroupToProductDocument,
    assignProductOptionGroupsToChannelDocument,
    createChannelDocument,
    createProductDocument,
    createProductOptionGroupDocument,
    createProductVariantsDocument,
    deleteProductOptionGroupDocument,
    deleteProductVariantDocument,
    removeOptionGroupFromProductDocument,
    removeProductOptionGroupsFromChannelDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductOption resolver', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());
    let sizeGroup: ResultOf<typeof productOptionGroupFragment>;
    let mediumOption: ResultOf<typeof createProductOptionDocument>['createProductOption'];

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('createProductOptionGroup', async () => {
        const { createProductOptionGroup } = await adminClient.query(createProductOptionGroupDocument, {
            input: {
                code: 'size',
                translations: [
                    { languageCode: LanguageCode.en, name: 'Size' },
                    { languageCode: LanguageCode.de, name: 'Größe' },
                ],
                options: [
                    {
                        code: 'small',
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Small' },
                            { languageCode: LanguageCode.de, name: 'Klein' },
                        ],
                    },
                    {
                        code: 'large',
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Large' },
                            { languageCode: LanguageCode.de, name: 'Groß' },
                        ],
                    },
                ],
            },
        });

        expect(omit(createProductOptionGroup, ['options', 'translations'])).toEqual({
            id: 'T_3',
            name: 'Size',
            code: 'size',
        });
        sizeGroup = createProductOptionGroup;
    });

    it('updateProductOptionGroup', async () => {
        const { updateProductOptionGroup } = await adminClient.query(updateProductOptionGroupLocalDocument, {
            input: {
                id: sizeGroup.id,
                translations: [
                    { id: sizeGroup.translations[0].id, languageCode: LanguageCode.en, name: 'Bigness' },
                ],
            },
        });

        expect(updateProductOptionGroup.name).toBe('Bigness');
    });

    it(
        'createProductOption throws with invalid productOptionGroupId',
        assertThrowsWithMessage(async () => {
            const { createProductOption } = await adminClient.query(createProductOptionDocument, {
                input: {
                    productOptionGroupId: 'T_999',
                    code: 'medium',
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Medium' },
                        { languageCode: LanguageCode.de, name: 'Mittel' },
                    ],
                },
            });
        }, 'No ProductOptionGroup with the id "999" could be found'),
    );

    it('createProductOption', async () => {
        const { createProductOption } = await adminClient.query(createProductOptionDocument, {
            input: {
                productOptionGroupId: sizeGroup.id,
                code: 'medium',
                translations: [
                    { languageCode: LanguageCode.en, name: 'Medium' },
                    { languageCode: LanguageCode.de, name: 'Mittel' },
                ],
            },
        });

        expect(omit(createProductOption, ['translations'])).toEqual({
            id: 'T_7',
            groupId: sizeGroup.id,
            code: 'medium',
            name: 'Medium',
        });
        mediumOption = createProductOption;
    });

    it('getProductOption', async () => {
        const { productOption } = await adminClient.query(getProductOptionDocument, {
            id: 'T_7',
        });

        expect(productOption?.name).toBe('Medium');
    });

    it('productOptions query without groupId', async () => {
        const { productOptions } = await adminClient.query(getProductOptionsDocument, {});

        expect(productOptions.items).toBeDefined();
        expect(productOptions.totalItems).toBe(7);
        // Should return all product options
        const foundMediumOption = productOptions.items.find((o: any) => o.code === 'medium');
        expect(foundMediumOption).toBeDefined();
        expect(foundMediumOption?.name).toBe('Medium');
        expect(foundMediumOption?.groupId).toBe(sizeGroup.id);
    });

    it('productOptions query with groupId', async () => {
        const { productOptions } = await adminClient.query(getProductOptionsDocument, {
            groupId: sizeGroup.id,
        });

        expect(productOptions.items).toBeDefined();
        expect(productOptions.totalItems).toBe(3);
        // Should only return options from the specified group
        productOptions.items.forEach((option: any) => {
            expect(option.groupId).toBe(sizeGroup.id);
        });
        const foundMediumOption = productOptions.items.find((o: any) => o.code === 'medium');
        expect(foundMediumOption).toBeDefined();
        expect(foundMediumOption?.name).toBe('Medium');
    });

    it('updateProductOption', async () => {
        const { updateProductOption } = await adminClient.query(updateProductOptionDocument, {
            input: {
                id: 'T_7',
                translations: [
                    { id: mediumOption.translations[0].id, languageCode: LanguageCode.en, name: 'Middling' },
                ],
            },
        });

        expect(updateProductOption.name).toBe('Middling');
    });

    describe('deletion', () => {
        let sizeOptionGroupWithOptions: NonNullable<
            ResultOf<typeof getProductOptionGroupDocument>['productOptionGroup']
        >;
        let variants: ResultOf<typeof createProductVariantsDocument>['createProductVariants'];

        beforeAll(async () => {
            // Create a new product with a variant in each size option
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'T-shirt',
                            slug: 't-shirt',
                            description: 'A television set',
                        },
                    ],
                },
            });

            const result = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: sizeGroup.id,
                productId: createProduct.id,
            });

            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: sizeGroup.id,
            });

            const variantInput = productOptionGroup!.options.map((option, i) => ({
                productId: createProduct.id,
                sku: `TS-${option.code}`,
                optionIds: [option.id],
                translations: [{ languageCode: LanguageCode.en, name: `T-shirt ${option.code}` }],
            }));

            const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                input: variantInput,
            });
            variants = createProductVariants;
            sizeOptionGroupWithOptions = productOptionGroup!;
        });

        it(
            'attempting to delete a non-existent id throws',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(deleteProductOptionDocument, {
                        id: '999999',
                    }),
                'No ProductOption with the id "999999" could be found',
            ),
        );

        it('cannot delete ProductOption that is used by a ProductVariant', async () => {
            const { deleteProductOption } = await adminClient.query(deleteProductOptionDocument, {
                id: sizeOptionGroupWithOptions.options.find(o => o.code === 'medium')!.id,
            });

            expect(deleteProductOption.result).toBe(DeletionResult.NOT_DELETED);
            expect(deleteProductOption.message).toBe(
                'Cannot delete the option "medium" as it is being used by 1 ProductVariant',
            );
        });

        it('can delete ProductOption after deleting associated ProductVariant', async () => {
            const { deleteProductVariant } = await adminClient.query(deleteProductVariantDocument, {
                id: variants.find(v => v!.name.includes('medium'))!.id,
            });

            expect(deleteProductVariant.result).toBe(DeletionResult.DELETED);

            const { deleteProductOption } = await adminClient.query(deleteProductOptionDocument, {
                id: sizeOptionGroupWithOptions.options.find(o => o.code === 'medium')!.id,
            });

            expect(deleteProductOption.result).toBe(DeletionResult.DELETED);
        });

        it('deleted ProductOptions not included in query result', async () => {
            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: sizeGroup.id,
            });

            expect(productOptionGroup?.options.length).toBe(2);
            expect(productOptionGroup?.options.findIndex(o => o.code === 'medium')).toBe(-1);
        });
    });

    describe('standalone deleteProductOptionGroup', () => {
        let unusedGroup: ResultOf<typeof productOptionGroupFragment>;
        let inUseGroup: ResultOf<typeof productOptionGroupFragment>;
        let testProduct: ResultOf<typeof createProductDocument>['createProduct'];

        beforeAll(async () => {
            // Create a group that is not used by any product
            const { createProductOptionGroup: unused } = await adminClient.query(
                createProductOptionGroupDocument,
                {
                    input: {
                        code: 'unused-group',
                        translations: [{ languageCode: LanguageCode.en, name: 'Unused' }],
                        options: [
                            {
                                code: 'unused-opt',
                                translations: [{ languageCode: LanguageCode.en, name: 'Unused Option' }],
                            },
                        ],
                    },
                },
            );
            unusedGroup = unused;

            // Create a group that IS used by a product
            const { createProductOptionGroup: inUse } = await adminClient.query(
                createProductOptionGroupDocument,
                {
                    input: {
                        code: 'in-use-group',
                        translations: [{ languageCode: LanguageCode.en, name: 'In Use' }],
                        options: [
                            {
                                code: 'in-use-opt',
                                translations: [{ languageCode: LanguageCode.en, name: 'In Use Option' }],
                            },
                        ],
                    },
                },
            );
            inUseGroup = inUse;

            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Delete Test Product',
                            slug: 'delete-test-product',
                            description: 'test',
                        },
                    ],
                },
            });
            testProduct = createProduct;

            await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: inUseGroup.id,
                productId: testProduct.id,
            });
        });

        it('deleteProductOptionGroup deletes unused group', async () => {
            const { deleteProductOptionGroup } = await adminClient.query(deleteProductOptionGroupDocument, {
                id: unusedGroup.id,
            });
            expect(deleteProductOptionGroup.result).toBe(DeletionResult.DELETED);

            // Verify it's gone
            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: unusedGroup.id,
            });
            expect(productOptionGroup).toBeNull();
        });

        it('deleteProductOptionGroup fails when in use by products', async () => {
            const { deleteProductOptionGroup } = await adminClient.query(deleteProductOptionGroupDocument, {
                id: inUseGroup.id,
            });
            expect(deleteProductOptionGroup.result).toBe(DeletionResult.NOT_DELETED);
            expect(deleteProductOptionGroup.message).toContain('in-use-group');
        });

        it('deleteProductOptionGroup with force removes from products and deletes', async () => {
            const { deleteProductOptionGroup } = await adminClient.query(deleteProductOptionGroupDocument, {
                id: inUseGroup.id,
                force: true,
            });
            expect(deleteProductOptionGroup.result).toBe(DeletionResult.DELETED);

            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: inUseGroup.id,
            });
            expect(productOptionGroup).toBeNull();
        });
    });

    describe('sharing option groups between products', () => {
        let sharedGroup: ResultOf<typeof productOptionGroupFragment>;
        let productA: ResultOf<typeof createProductDocument>['createProduct'];
        let productB: ResultOf<typeof createProductDocument>['createProduct'];

        beforeAll(async () => {
            const { createProductOptionGroup } = await adminClient.query(createProductOptionGroupDocument, {
                input: {
                    code: 'shared-color',
                    translations: [{ languageCode: LanguageCode.en, name: 'Color' }],
                    options: [
                        {
                            code: 'red',
                            translations: [{ languageCode: LanguageCode.en, name: 'Red' }],
                        },
                        {
                            code: 'blue',
                            translations: [{ languageCode: LanguageCode.en, name: 'Blue' }],
                        },
                    ],
                },
            });
            sharedGroup = createProductOptionGroup;

            const { createProduct: pA } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Product A',
                            slug: 'product-a',
                            description: 'Product A',
                        },
                    ],
                },
            });
            productA = pA;

            const { createProduct: pB } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Product B',
                            slug: 'product-b',
                            description: 'Product B',
                        },
                    ],
                },
            });
            productB = pB;
        });

        it('can add same option group to multiple products', async () => {
            const resultA = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: sharedGroup.id,
                productId: productA.id,
            });
            expect(resultA.addOptionGroupToProduct.optionGroups.map((g: any) => g.id)).toContain(
                sharedGroup.id,
            );

            const resultB = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: sharedGroup.id,
                productId: productB.id,
            });
            expect(resultB.addOptionGroupToProduct.optionGroups.map((g: any) => g.id)).toContain(
                sharedGroup.id,
            );
        });

        it('addOptionGroupToProduct is idempotent', async () => {
            const result = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: sharedGroup.id,
                productId: productA.id,
            });
            // Should not duplicate the group
            const groupIds = result.addOptionGroupToProduct.optionGroups.map((g: any) => g.id);
            const sharedCount = groupIds.filter((id: string) => id === sharedGroup.id).length;
            expect(sharedCount).toBe(1);
        });

        it('removing from one product does not affect the other', async () => {
            const { removeOptionGroupFromProduct } = await adminClient.query(
                removeOptionGroupFromProductDocument,
                {
                    optionGroupId: sharedGroup.id,
                    productId: productA.id,
                },
            );

            // Group should still be accessible
            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: sharedGroup.id,
            });
            expect(productOptionGroup).not.toBeNull();
            expect(productOptionGroup!.code).toBe('shared-color');
        });
    });

    describe('channels', () => {
        const SECOND_CHANNEL_TOKEN = 'second_channel_token';
        let secondChannel: FragmentOf<typeof channelFragment>;
        let channelGroup: ResultOf<typeof productOptionGroupFragment>;

        beforeAll(async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            secondChannel = createChannel as FragmentOf<typeof channelFragment>;

            // Create a group in the default channel
            const { createProductOptionGroup } = await adminClient.query(createProductOptionGroupDocument, {
                input: {
                    code: 'channel-test-group',
                    translations: [{ languageCode: LanguageCode.en, name: 'Channel Test' }],
                    options: [
                        {
                            code: 'ch-opt-1',
                            translations: [{ languageCode: LanguageCode.en, name: 'Ch Opt 1' }],
                        },
                    ],
                },
            });
            channelGroup = createProductOptionGroup;
        });

        it('option group created in default channel is not visible in second channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: channelGroup.id,
            });
            expect(productOptionGroup).toBeNull();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('assignProductOptionGroupsToChannel assigns group to second channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignProductOptionGroupsToChannel } = await adminClient.query(
                assignProductOptionGroupsToChannelDocument,
                {
                    input: {
                        productOptionGroupIds: [channelGroup.id],
                        channelId: secondChannel.id,
                    },
                },
            );
            expect(assignProductOptionGroupsToChannel.length).toBe(1);
            expect(assignProductOptionGroupsToChannel[0].code).toBe('channel-test-group');
        });

        it('option group is now visible in second channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: channelGroup.id,
            });
            expect(productOptionGroup).not.toBeNull();
            expect(productOptionGroup!.code).toBe('channel-test-group');
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('removeProductOptionGroupsFromChannel removes from second channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removeProductOptionGroupsFromChannel } = await adminClient.query(
                removeProductOptionGroupsFromChannelDocument,
                {
                    input: {
                        productOptionGroupIds: [channelGroup.id],
                        channelId: secondChannel.id,
                    },
                },
            );
            expect(removeProductOptionGroupsFromChannel.length).toBe(1);

            // Verify it's gone from second channel
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productOptionGroup } = await adminClient.query(getProductOptionGroupDocument, {
                id: channelGroup.id,
            });
            expect(productOptionGroup).toBeNull();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('prevents removal from default channel', async () => {
            try {
                await adminClient.query(removeProductOptionGroupsFromChannelDocument, {
                    input: {
                        productOptionGroupIds: [channelGroup.id],
                        channelId: 'T_1', // default channel
                    },
                });
                expect.unreachable('Should have thrown');
            } catch (e: any) {
                expect(e.message).toContain('default Channel');
            }
        });
    });
});

const updateProductOptionGroupLocalDocument = graphql(
    `
        mutation UpdateProductOptionGroup($input: UpdateProductOptionGroupInput!) {
            updateProductOptionGroup(input: $input) {
                ...ProductOptionGroup
            }
        }
    `,
    [productOptionGroupFragment],
);

const getProductOptionGroupDocument = graphql(`
    query GetProductOptionGroup($id: ID!) {
        productOptionGroup(id: $id) {
            id
            code
            name
            options {
                id
                code
                name
            }
        }
    }
`);

const createProductOptionDocument = graphql(`
    mutation CreateProductOption($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
            code
            name
            groupId
            translations {
                id
                languageCode
                name
            }
        }
    }
`);

const getProductOptionDocument = graphql(`
    query GetProductOption($id: ID!) {
        productOption(id: $id) {
            id
            name
            code
        }
    }
`);

const updateProductOptionDocument = graphql(`
    mutation UpdateProductOption($input: UpdateProductOptionInput!) {
        updateProductOption(input: $input) {
            id
            code
            name
            groupId
        }
    }
`);

const deleteProductOptionDocument = graphql(`
    mutation DeleteProductOption($id: ID!) {
        deleteProductOption(id: $id) {
            result
            message
        }
    }
`);

const getProductOptionsDocument = graphql(`
    query GetProductOptions($groupId: ID, $options: ProductOptionListOptions) {
        productOptions(groupId: $groupId, options: $options) {
            items {
                id
                code
                name
                groupId
            }
            totalItems
        }
    }
`);
