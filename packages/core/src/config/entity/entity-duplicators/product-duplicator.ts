import {
    CreateProductInput,
    CreateProductVariantInput,
    LanguageCode,
    Permission,
    ProductTranslationInput,
} from '@vendure/common/lib/generated-types';
import { IsNull } from 'typeorm';

import { idsAreEqual } from '../../../common';
import { Injector } from '../../../common/injector';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { ProductService } from '../../../service/services/product.service';
import { EntityDuplicator } from '../entity-duplicator';

let connection: TransactionalConnection;
let productService: ProductService;
let productVariantService: ProductVariantService;

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
    },
    init(injector: Injector) {
        connection = injector.get(TransactionalConnection);
        productService = injector.get(ProductService);
        productVariantService = injector.get(ProductVariantService);
    },
    async duplicate({ ctx, id, args }) {
        const product = await connection.getEntityOrThrow(ctx, Product, id, {
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
            if (product.optionGroups?.length) {
                for (const optionGroup of product.optionGroups) {
                    await productService.addOptionGroupToProduct(ctx, duplicatedProduct.id, optionGroup.id);
                }
            }
            const variantInput: CreateProductVariantInput[] = productVariants.map((variant, i) => {
                const optionIds = variant.options.map(o => o.id);
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
