import {
    CreateProductInput,
    CreateProductVariantInput,
    LanguageCode,
    Permission,
    ProductTranslationInput,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { IsNull } from 'typeorm';

import { idsAreEqual } from '../../../common';
import { Injector } from '../../../common/injector';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';
import { ProductOptionGroupService } from '../../../service/services/product-option-group.service';
import { ProductOptionService } from '../../../service/services/product-option.service';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { ProductService } from '../../../service/services/product.service';
import { EntityDuplicator } from '../entity-duplicator';

let connection: TransactionalConnection;
let productService: ProductService;
let productVariantService: ProductVariantService;
let productOptionGroupService: ProductOptionGroupService;
let productOptionService: ProductOptionService;

/**
 * @description
 * Duplicates a Product and its associated ProductVariants.
 */
export const productDuplicator = new EntityDuplicator({
    code: 'product-duplicator',
    description: [
        {
            languageCode: LanguageCode.en,
            value: 'Default duplicator for Products',
        },
    ],
    requiresPermission: [Permission.CreateProduct, Permission.CreateCatalog],
    forEntities: ['Product'],
    args: {
        includeVariants: {
            type: 'boolean',
            defaultValue: true,
            label: [{ languageCode: LanguageCode.en, value: 'Include variants' }],
        },
        duplicateOptions: {
            type: 'boolean',
            defaultValue: false,
            label: [{ languageCode: LanguageCode.en, value: 'Duplicate options' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'If enabled, new option groups/options are created for the duplicate. Otherwise it shares the original’s option groups.',
                },
            ],
        },
    },
    init(injector: Injector) {
        connection = injector.get(TransactionalConnection);
        productService = injector.get(ProductService);
        productVariantService = injector.get(ProductVariantService);
        productOptionGroupService = injector.get(ProductOptionGroupService);
        productOptionService = injector.get(ProductOptionService);
    },
    async duplicate({ ctx, id, args }) {
        const product = await connection.getEntityOrThrow(ctx, Product, id, {
            channelId: ctx.channelId,
            relations: {
                featuredAsset: true,
                assets: true,
                channels: true,
                facetValues: {
                    facet: true,
                },
                optionGroups: {
                    options: true,
                },
            },
        });
        const translations: ProductTranslationInput[] = product.translations.map(translation => {
            return {
                name: translation.name + ' (copy)',
                slug: translation.slug + '-copy',
                description: translation.description,
                languageCode: translation.languageCode,
                customFields: translation.customFields,
            };
        });
        const productInput: CreateProductInput = {
            featuredAssetId: product.featuredAsset?.id,
            enabled: false,
            assetIds: product.assets.map(value => value.assetId),
            facetValueIds: product.facetValues.map(value => value.id),
            translations,
            customFields: product.customFields,
        };

        const duplicatedProduct = await productService.create(ctx, productInput);

        if (args.includeVariants) {
            const productVariants = await connection.getRepository(ctx, ProductVariant).find({
                where: {
                    productId: id,
                    deletedAt: IsNull(),
                    // A Product can be assigned to a channel without all of its variants
                    // being assigned too, so the variants are scoped to the active channel
                    // as well as the parent Product.
                    channels: { id: ctx.channelId },
                },
                relations: {
                    options: {
                        group: true,
                    },
                    assets: true,
                    featuredAsset: true,
                    stockLevels: true,
                    facetValues: true,
                    productVariantPrices: true,
                    taxCategory: true,
                },
            });
            const optionIdMap = new Map<ID, ID>();
            if (product.optionGroups?.length) {
                for (const optionGroup of product.optionGroups) {
                    if (args.duplicateOptions) {
                        // Create a new ProductOptionGroup
                        const duplicatedGroup = await productOptionGroupService.create(ctx, {
                            code: `${optionGroup.code}-copy`,
                            translations: optionGroup.translations.map(translation => ({
                                languageCode: translation.languageCode,
                                name: translation.name,
                                customFields: translation.customFields,
                            })),
                            customFields: optionGroup.customFields,
                        });
                        await productService.addOptionGroupToProduct(
                            ctx,
                            duplicatedProduct.id,
                            duplicatedGroup.id,
                        );
                        // Duplicate every ProductOption
                        for (const option of optionGroup.options) {
                            const duplicatedOption = await productOptionService.create(
                                ctx,
                                duplicatedGroup.id,
                                {
                                    code: `${option.code}-copy`,
                                    customFields: option.customFields,
                                    translations: option.translations.map(translation => ({
                                        languageCode: translation.languageCode,
                                        name: translation.name,
                                        customFields: translation.customFields,
                                    })),
                                },
                            );
                            optionIdMap.set(option.id, duplicatedOption.id);
                        }
                    } else {
                        // Share the original ProductOptionGroup with the duplicate
                        await productService.addOptionGroupToProduct(
                            ctx,
                            duplicatedProduct.id,
                            optionGroup.id,
                        );
                    }
                }
            }
            const variantInput: CreateProductVariantInput[] = productVariants.map((variant, i) => {
                const optionIds = variant.options.map(o => {
                    if (!args.duplicateOptions) {
                        return o.id;
                    }
                    const duplicatedOptionId = optionIdMap.get(o.id);
                    if (!duplicatedOptionId) {
                        throw new Error(`Failed to locate duplicated ProductOption for option ${o.id}`);
                    }
                    return duplicatedOptionId;
                });
                const price =
                    variant.productVariantPrices.find(p => idsAreEqual(p.channelId, ctx.channelId))?.price ??
                    variant.productVariantPrices[0]?.price;
                return {
                    productId: duplicatedProduct.id,
                    price: price ?? variant.price,
                    sku: `${variant.sku}-copy`,
                    stockOnHand: 1,
                    featuredAssetId: variant.featuredAsset?.id,
                    taxCategoryId: variant.taxCategory?.id,
                    useGlobalOutOfStockThreshold: variant.useGlobalOutOfStockThreshold,
                    trackInventory: variant.trackInventory,
                    assetIds: variant.assets.map(value => value.assetId),
                    translations: variant.translations.map(translation => {
                        return {
                            languageCode: translation.languageCode,
                            name: translation.name,
                            customFields: translation.customFields,
                        };
                    }),
                    optionIds,
                    facetValueIds: variant.facetValues.map(value => value.id),
                    stockLevels: variant.stockLevels.map(stockLevel => ({
                        stockLocationId: stockLevel.stockLocationId,
                        stockOnHand: stockLevel.stockOnHand,
                    })),
                    customFields: variant.customFields,
                };
            });
            const duplicatedProductVariants = await productVariantService.create(ctx, variantInput);
            duplicatedProduct.variants = duplicatedProductVariants;
        }

        return duplicatedProduct;
    },
});
