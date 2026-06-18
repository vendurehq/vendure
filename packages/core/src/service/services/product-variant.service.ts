import { Injectable } from '@nestjs/common';
import {
    AssignProductVariantsToChannelInput,
    CreateProductVariantInput,
    CurrencyCode,
    DeletionResponse,
    DeletionResult,
    GlobalFlag,
    Permission,
    ProductVariantFilterParameter,
    RemoveProductVariantsFromChannelInput,
    UpdateProductVariantInput,
} from '@vendure/common/lib/generated-types';
import { CustomFieldsObject, ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In, IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { ForbiddenError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { roundMoney } from '../../common/round-money';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { idsAreEqual } from '../../common/utils';
import { UpdatedProductVariantPrice } from '../../config/catalog/product-variant-price-update-strategy';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import {
    Channel,
    Order,
    OrderLine,
    ProductOptionGroup,
    ProductVariantPrice,
    TaxCategory,
} from '../../entity';
import { FacetValue } from '../../entity/facet-value/facet-value.entity';
import { ProductOption } from '../../entity/product-option/product-option.entity';
import { ProductVariantTranslation } from '../../entity/product-variant/product-variant-translation.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Product } from '../../entity/product/product.entity';
import { EventBus } from '../../event-bus/event-bus';
import { ProductVariantChannelEvent } from '../../event-bus/events/product-variant-channel-event';
import { ProductVariantEvent } from '../../event-bus/events/product-variant-event';
import { ProductVariantPriceEvent } from '../../event-bus/events/product-variant-price-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { ProductPriceApplicator } from '../helpers/product-price-applicator/product-price-applicator';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { patchEntity } from '../helpers/utils/patch-entity';
import { samplesEach } from '../helpers/utils/samples-each';

import { AssetService } from './asset.service';
import { ChannelService } from './channel.service';
import { FacetValueService } from './facet-value.service';
import { GlobalSettingsService } from './global-settings.service';
import { RoleService } from './role.service';
import { StockLevelService } from './stock-level.service';
import { StockMovementService } from './stock-movement.service';
import { TaxCategoryService } from './tax-category.service';

/**
 * @description
 * Contains methods relating to {@link ProductVariant} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ProductVariantService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private taxCategoryService: TaxCategoryService,
        private facetValueService: FacetValueService,
        private assetService: AssetService,
        private translatableSaver: TranslatableSaver,
        private eventBus: EventBus,
        private listQueryBuilder: ListQueryBuilder,
        private globalSettingsService: GlobalSettingsService,
        private stockMovementService: StockMovementService,
        private stockLevelService: StockLevelService,
        private channelService: ChannelService,
        private roleService: RoleService,
        private customFieldRelationService: CustomFieldRelationService,
        private requestCache: RequestContextCacheService,
        private productPriceApplicator: ProductPriceApplicator,
        private translator: TranslatorService,
    ) {}

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ProductVariant>,
    ): Promise<PaginatedList<Translated<ProductVariant>>> {
        const relations = ['featuredAsset', 'taxCategory', 'channels'];
        const customPropertyMap: { [name: string]: string } = {};
        const hasFacetValueIdFilter =
            this.listQueryBuilder.filterObjectHasProperty<ProductVariantFilterParameter>(
                options?.filter,
                'facetValueId',
            );
        if (hasFacetValueIdFilter) {
            relations.push('facetValues');
            customPropertyMap.facetValueId = 'facetValues.id';
        }
        return this.listQueryBuilder
            .build(ProductVariant, options, {
                relations,
                channelId: ctx.channelId,
                where: { deletedAt: IsNull() },
                ctx,
                customPropertyMap,
            })
            .getManyAndCount()
            .then(async ([variants, totalItems]) => {
                const items = await this.applyPricesAndTranslateVariants(ctx, variants);
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        productVariantId: ID,
        relations?: RelationPaths<ProductVariant>,
    ): Promise<Translated<ProductVariant> | undefined> {
        return this.connection
            .findOneInChannel(ctx, ProductVariant, productVariantId, ctx.channelId, {
                relations: [
                    ...(relations || ['product', 'featuredAsset', 'product.featuredAsset']),
                    'taxCategory',
                ],
                where: { deletedAt: IsNull() },
            })
            .then(async result => {
                if (result) {
                    return this.translator.translate(await this.applyChannelPriceAndTax(result, ctx), ctx, [
                        'product',
                    ]);
                }
            });
    }

    findByIds(ctx: RequestContext, ids: ID[]): Promise<Array<Translated<ProductVariant>>> {
        return this.connection
            .findByIdsInChannel(ctx, ProductVariant, ids, ctx.channelId, {
                relations: [
                    'options',
                    'facetValues',
                    'facetValues.facet',
                    'taxCategory',
                    'assets',
                    'featuredAsset',
                ],
            })
            .then(variants => this.applyPricesAndTranslateVariants(ctx, variants));
    }

    getVariantsByProductId(
        ctx: RequestContext,
        productId: ID,
        options: ListQueryOptions<ProductVariant> = {},
        relations?: RelationPaths<ProductVariant>,
    ): Promise<PaginatedList<Translated<ProductVariant>>> {
        const qb = this.listQueryBuilder
            .build(ProductVariant, options, {
                relations: [
                    ...(relations || [
                        'options',
                        'facetValues',
                        'facetValues.facet',
                        'assets',
                        'featuredAsset',
                    ]),
                    'taxCategory',
                ],
                orderBy: { id: 'ASC' },
                where: { deletedAt: IsNull() },
                ctx,
            })
            .innerJoinAndSelect('productvariant.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoinAndSelect('productvariant.product', 'product', 'product.id = :productId', {
                productId,
            });

        if (ctx.apiType === 'shop') {
            qb.andWhere('productvariant.enabled = :enabled', { enabled: true });
        }

        return qb.getManyAndCount().then(async ([variants, totalItems]) => {
            const items = await this.applyPricesAndTranslateVariants(ctx, variants);
            return {
                items,
                totalItems,
            };
        });
    }

    /**
     * @description
     * Returns a {@link PaginatedList} of all ProductVariants associated with the given Collection.
     */
    getVariantsByCollectionId(
        ctx: RequestContext,
        collectionId: ID,
        options: ListQueryOptions<ProductVariant>,
        relations: RelationPaths<ProductVariant> = [],
    ): Promise<PaginatedList<Translated<ProductVariant>>> {
        const qb = this.listQueryBuilder
            .build(ProductVariant, options, {
                relations: unique([...relations, 'taxCategory']),
                channelId: ctx.channelId,
                ctx,
            })
            .leftJoin('productvariant.collections', 'collection')
            .leftJoin('productvariant.product', 'product')
            .andWhere('product.deletedAt IS NULL')
            .andWhere('productvariant.deletedAt IS NULL')
            .andWhere('collection.id = :collectionId', { collectionId });

        if (options && options.filter && options.filter.enabled && options.filter.enabled.eq === true) {
            qb.andWhere('product.enabled = :enabled', { enabled: true });
        }

        return qb.getManyAndCount().then(async ([variants, totalItems]) => {
            const items = await this.applyPricesAndTranslateVariants(ctx, variants);
            return {
                items,
                totalItems,
            };
        });
    }

    /**
     * @description
     * Returns all Channels to which the ProductVariant is assigned.
     */
    async getProductVariantChannels(ctx: RequestContext, productVariantId: ID): Promise<Channel[]> {
        const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, productVariantId, {
            relations: ['channels'],
            channelId: ctx.channelId,
        });
        return variant.channels;
    }

    async getProductVariantPrices(ctx: RequestContext, productVariantId: ID): Promise<ProductVariantPrice[]> {
        return this.connection
            .getRepository(ctx, ProductVariantPrice)
            .createQueryBuilder('pvp')
            .where('pvp.variant = :productVariantId', { productVariantId })
            .andWhere('pvp.channelId = :channelId', { channelId: ctx.channelId })
            .getMany();
    }

    /**
     * @description
     * Returns the ProductVariant associated with the given {@link OrderLine}.
     */
    async getVariantByOrderLineId(ctx: RequestContext, orderLineId: ID): Promise<Translated<ProductVariant>> {
        const { productVariant } = await this.connection.getEntityOrThrow(ctx, OrderLine, orderLineId, {
            relations: ['productVariant', 'productVariant.taxCategory'],
            includeSoftDeleted: true,
        });
        return this.translator.translate(await this.applyChannelPriceAndTax(productVariant, ctx), ctx);
    }

    /**
     * @description
     * Returns the {@link ProductOption}s for the given ProductVariant.
     */
    getOptionsForVariant(ctx: RequestContext, variantId: ID): Promise<Array<Translated<ProductOption>>> {
        return this.connection
            .findOneInChannel(ctx, ProductVariant, variantId, ctx.channelId, {
                relations: ['options'],
            })
            .then(variant => (!variant ? [] : variant.options.map(o => this.translator.translate(o, ctx))));
    }

    getFacetValuesForVariant(ctx: RequestContext, variantId: ID): Promise<Array<Translated<FacetValue>>> {
        return this.connection
            .findOneInChannel(ctx, ProductVariant, variantId, ctx.channelId, {
                relations: ['facetValues', 'facetValues.facet', 'facetValues.channels'],
            })
            .then(variant =>
                !variant ? [] : variant.facetValues.map(o => this.translator.translate(o, ctx, ['facet'])),
            );
    }

    /**
     * @description
     * Returns the Product associated with the ProductVariant. Whereas the `ProductService.findOne()`
     * method performs a large multi-table join with all the typical data needed for a "product detail"
     * page, this method returns only the Product itself.
     */
    async getProductForVariant(ctx: RequestContext, variant: ProductVariant): Promise<Translated<Product>> {
        let product;

        if (!variant.product) {
            product = await this.connection.getEntityOrThrow(ctx, Product, variant.productId, {
                includeSoftDeleted: true,
            });
        } else {
            product = variant.product;
        }

        return this.translator.translate(product, ctx);
    }

    /**
     * @description
     * Returns the number of saleable units of the ProductVariant, i.e. how many are available
     * for purchase by Customers. This is determined by the ProductVariant's `stockOnHand` value,
     * as well as the local and global `outOfStockThreshold` settings.
     */
    async getSaleableStockLevel(ctx: RequestContext, variant: ProductVariant): Promise<number> {
        const { outOfStockThreshold, trackInventory } = await this.globalSettingsService.getSettings(ctx);

        const inventoryNotTracked =
            variant.trackInventory === GlobalFlag.FALSE ||
            (variant.trackInventory === GlobalFlag.INHERIT && trackInventory === false);
        if (inventoryNotTracked) {
            return Number.MAX_SAFE_INTEGER;
        }
        const { stockOnHand, stockAllocated } = await this.stockLevelService.getAvailableStock(
            ctx,
            variant.id,
        );
        const effectiveOutOfStockThreshold = variant.useGlobalOutOfStockThreshold
            ? outOfStockThreshold
            : variant.outOfStockThreshold;

        return stockOnHand - stockAllocated - effectiveOutOfStockThreshold;
    }

    private async getOutOfStockThreshold(ctx: RequestContext, variant: ProductVariant): Promise<number> {
        const { outOfStockThreshold, trackInventory } = await this.globalSettingsService.getSettings(ctx);

        const inventoryNotTracked =
            variant.trackInventory === GlobalFlag.FALSE ||
            (variant.trackInventory === GlobalFlag.INHERIT && trackInventory === false);
        if (inventoryNotTracked) {
            return 0;
        } else {
            return variant.useGlobalOutOfStockThreshold ? outOfStockThreshold : variant.outOfStockThreshold;
        }
    }

    /**
     * @description
     * Returns the stockLevel to display to the customer, as specified by the configured
     * {@link StockDisplayStrategy}.
     */
    async getDisplayStockLevel(ctx: RequestContext, variant: ProductVariant): Promise<string> {
        const { stockDisplayStrategy } = this.configService.catalogOptions;
        const saleableStockLevel = await this.getSaleableStockLevel(ctx, variant);
        return stockDisplayStrategy.getStockLevel(ctx, variant, saleableStockLevel);
    }

    /**
     * @description
     * Returns the number of fulfillable units of the ProductVariant, equivalent to stockOnHand
     * for those variants which are tracking inventory.
     */
    async getFulfillableStockLevel(ctx: RequestContext, variant: ProductVariant): Promise<number> {
        const { outOfStockThreshold, trackInventory } = await this.globalSettingsService.getSettings(ctx);
        const inventoryNotTracked =
            variant.trackInventory === GlobalFlag.FALSE ||
            (variant.trackInventory === GlobalFlag.INHERIT && trackInventory === false);
        if (inventoryNotTracked) {
            return Number.MAX_SAFE_INTEGER;
        }
        const { stockOnHand } = await this.stockLevelService.getAvailableStock(ctx, variant.id);
        return stockOnHand;
    }

    async create(
        ctx: RequestContext,
        input: CreateProductVariantInput[],
    ): Promise<Array<Translated<ProductVariant>>> {
        const ids: ID[] = [];
        for (const productInput of input) {
            const id = await this.createSingle(ctx, productInput);
            ids.push(id);
        }
        const createdVariants = await this.findByIds(ctx, ids);
        await this.eventBus.publish(new ProductVariantEvent(ctx, createdVariants, 'created', input));
        return createdVariants;
    }

    async update(
        ctx: RequestContext,
        input: UpdateProductVariantInput[],
    ): Promise<Array<Translated<ProductVariant>>> {
        for (const productInput of input) {
            await this.updateSingle(ctx, productInput);
        }
        const updatedVariants = await this.findByIds(
            ctx,
            input.map(i => i.id),
        );
        await this.eventBus.publish(new ProductVariantEvent(ctx, updatedVariants, 'updated', input));
        return updatedVariants;
    }

    private async createSingle(ctx: RequestContext, input: CreateProductVariantInput): Promise<ID> {
        await this.validateVariantOptionIds(ctx, input.productId, input.optionIds);
        if (!input.optionIds) {
            input.optionIds = [];
        }
        if (input.price == null) {
            input.price = 0;
        }
        input.taxCategoryId = (await this.getTaxCategoryForNewVariant(ctx, input.taxCategoryId)).id;
        const inputWithoutPrice = {
            ...input,
        };
        delete inputWithoutPrice.price;
        const createdVariant = await this.translatableSaver.create({
            ctx,
            input: inputWithoutPrice,
            entityType: ProductVariant,
            translationType: ProductVariantTranslation,
            beforeSave: async variant => {
                const { optionIds } = input;
                if (optionIds && optionIds.length) {
                    const selectedOptions = await this.connection
                        .getRepository(ctx, ProductOption)
                        .find({ where: { id: In(optionIds) } });
                    variant.options = selectedOptions;
                }
                if (input.facetValueIds) {
                    variant.facetValues = await this.facetValueService.findByIds(ctx, input.facetValueIds);
                }
                variant.product = { id: input.productId } as any;
                variant.taxCategory = { id: input.taxCategoryId } as any;
                await this.assetService.updateFeaturedAsset(ctx, variant, input);
                await this.channelService.assignToCurrentChannel(variant, ctx);
            },
            typeOrmSubscriberData: {
                channelId: ctx.channelId,
                taxCategoryId: input.taxCategoryId,
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, ProductVariant, input, createdVariant);
        await this.assetService.updateEntityAssets(ctx, createdVariant, input);
        if (input.stockOnHand != null || input.stockLevels) {
            await this.stockMovementService.adjustProductVariantStock(
                ctx,
                createdVariant.id,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                input.stockLevels || input.stockOnHand!,
            );
        }

        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        await this.createOrUpdateProductVariantPrice(ctx, createdVariant.id, input.price, ctx.channelId);
        if (!idsAreEqual(ctx.channelId, defaultChannel.id)) {
            // When creating a ProductVariant _not_ in the default Channel, we still need to
            // create a ProductVariantPrice for it in the default Channel, otherwise errors will
            // result when trying to query it there.
            await this.createOrUpdateProductVariantPrice(
                ctx,
                createdVariant.id,
                input.price,
                defaultChannel.id,
                defaultChannel.defaultCurrencyCode,
            );
        }
        return createdVariant.id;
    }

    private async updateSingle(ctx: RequestContext, input: UpdateProductVariantInput): Promise<ID> {
        const existingVariant = await this.connection.getEntityOrThrow(ctx, ProductVariant, input.id, {
            channelId: ctx.channelId,
            relations: ['facetValues', 'facetValues.channels'],
        });
        const outOfStockThreshold = await this.getOutOfStockThreshold(ctx, existingVariant);
        if (input.stockOnHand && input.stockOnHand < outOfStockThreshold) {
            throw new UserInputError('error.stockonhand-cannot-be-negative');
        }
        if (input.optionIds) {
            await this.validateVariantOptionIds(ctx, existingVariant.productId, input.optionIds, true);
        }
        const inputWithoutPriceAndStockLevels = {
            ...input,
        };
        delete inputWithoutPriceAndStockLevels.price;
        delete inputWithoutPriceAndStockLevels.stockLevels;
        const updatedVariant = await this.translatableSaver.update({
            ctx,
            input: inputWithoutPriceAndStockLevels,
            entityType: ProductVariant,
            translationType: ProductVariantTranslation,
            beforeSave: async v => {
                if (input.taxCategoryId) {
                    const taxCategory = await this.taxCategoryService.findOne(ctx, input.taxCategoryId);
                    if (taxCategory) {
                        v.taxCategory = taxCategory;
                    }
                }
                if (input.optionIds && input.optionIds.length) {
                    const selectedOptions = await this.connection
                        .getRepository(ctx, ProductOption)
                        .find({ where: { id: In(input.optionIds) } });
                    v.options = selectedOptions;
                }
                if (input.facetValueIds) {
                    const facetValuesInOtherChannels = existingVariant.facetValues.filter(fv =>
                        fv.channels.every(channel => !idsAreEqual(channel.id, ctx.channelId)),
                    );
                    v.facetValues = [
                        ...facetValuesInOtherChannels,
                        ...(await this.facetValueService.findByIds(ctx, input.facetValueIds)),
                    ];
                }
                if (input.stockOnHand != null || input.stockLevels) {
                    await this.stockMovementService.adjustProductVariantStock(
                        ctx,
                        existingVariant.id,
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        input.stockLevels || input.stockOnHand!,
                    );
                }
                await this.assetService.updateFeaturedAsset(ctx, v, input);
                await this.assetService.updateEntityAssets(ctx, v, input);
            },
            typeOrmSubscriberData: {
                channelId: ctx.channelId,
                taxCategoryId: input.taxCategoryId,
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, ProductVariant, input, updatedVariant);
        if (input.price != null) {
            await this.createOrUpdateProductVariantPrice(ctx, input.id, input.price, ctx.channelId);
        }
        if (input.prices) {
            for (const priceInput of input.prices) {
                if (priceInput.delete === true) {
                    await this.deleteProductVariantPrice(
                        ctx,
                        input.id,
                        ctx.channelId,
                        priceInput.currencyCode,
                    );
                } else {
                    await this.createOrUpdateProductVariantPrice(
                        ctx,
                        input.id,
                        priceInput.price,
                        ctx.channelId,
                        priceInput.currencyCode,
                        priceInput.customFields,
                    );
                }
            }
        }
        return updatedVariant.id;
    }

    /**
     * @description
     * Creates a {@link ProductVariantPrice} for the given ProductVariant/Channel combination.
     * If the `currencyCode` is not specified, the default currency of the Channel will be used.
     */
    async createOrUpdateProductVariantPrice(
        ctx: RequestContext,
        productVariantId: ID,
        price: number,
        channelId: ID,
        currencyCode?: CurrencyCode,
        customFields?: CustomFieldsObject,
    ): Promise<ProductVariantPrice> {
        const { productVariantPriceUpdateStrategy } = this.configService.catalogOptions;
        const allPrices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
            where: {
                variant: { id: productVariantId },
            },
        });
        let targetPrice = allPrices.find(
            p =>
                idsAreEqual(p.channelId, channelId) &&
                p.currencyCode === (currencyCode ?? ctx.channel.defaultCurrencyCode),
        );
        if (currencyCode) {
            const channel = await this.channelService.findOne(ctx, channelId);
            if (!channel?.availableCurrencyCodes.includes(currencyCode)) {
                throw new UserInputError('error.currency-not-available-in-channel', {
                    currencyCode,
                });
            }
        }
        let additionalPricesToUpdate: UpdatedProductVariantPrice[] = [];
        if (!targetPrice) {
            const createdPrice = await this.connection.getRepository(ctx, ProductVariantPrice).save(
                new ProductVariantPrice({
                    channelId,
                    price,
                    variant: new ProductVariant({ id: productVariantId }),
                    currencyCode: currencyCode ?? ctx.channel.defaultCurrencyCode,
                    customFields,
                }),
            );
            if (customFields) {
                await this.customFieldRelationService.updateRelations(
                    ctx,
                    ProductVariantPrice,
                    customFields,
                    createdPrice,
                );
            }
            await this.eventBus.publish(new ProductVariantPriceEvent(ctx, [createdPrice], 'created'));
            additionalPricesToUpdate = await productVariantPriceUpdateStrategy.onPriceCreated(
                ctx,
                createdPrice,
                allPrices,
            );
            targetPrice = createdPrice;
        } else {
            patchEntity(targetPrice, {
                price,
                customFields: customFields || targetPrice.customFields,
            });
            const updatedPrice = await this.connection
                .getRepository(ctx, ProductVariantPrice)
                .save(targetPrice);

            if (customFields) {
                await this.customFieldRelationService.updateRelations(
                    ctx,
                    ProductVariantPrice,
                    customFields,
                    updatedPrice,
                );
            }
            await this.eventBus.publish(new ProductVariantPriceEvent(ctx, [updatedPrice], 'updated'));
            additionalPricesToUpdate = await productVariantPriceUpdateStrategy.onPriceUpdated(
                ctx,
                updatedPrice,
                allPrices,
            );
        }
        const uniqueAdditionalPricesToUpdate = unique(additionalPricesToUpdate, 'id').filter(
            p =>
                // We don't save the targetPrice again unless it has been assigned
                // a different price by the ProductVariantPriceUpdateStrategy.
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                !(idsAreEqual(p.id, targetPrice.id) && p.price === targetPrice.price),
        );
        if (uniqueAdditionalPricesToUpdate.length) {
            const updatedAdditionalPrices = await this.connection
                .getRepository(ctx, ProductVariantPrice)
                .save(uniqueAdditionalPricesToUpdate);
            await this.eventBus.publish(
                new ProductVariantPriceEvent(ctx, updatedAdditionalPrices, 'updated'),
            );
        }
        return targetPrice;
    }

    async deleteProductVariantPrice(
        ctx: RequestContext,
        variantId: ID,
        channelId: ID,
        currencyCode: CurrencyCode,
    ) {
        const variantPrice = await this.connection.getRepository(ctx, ProductVariantPrice).findOne({
            where: {
                variant: { id: variantId },
                channelId,
                currencyCode,
            },
        });
        if (variantPrice) {
            await this.connection.getRepository(ctx, ProductVariantPrice).remove(variantPrice);
            await this.eventBus.publish(new ProductVariantPriceEvent(ctx, [variantPrice], 'deleted'));
            const { productVariantPriceUpdateStrategy } = this.configService.catalogOptions;
            const allPrices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
                where: {
                    variant: { id: variantId },
                },
            });
            const additionalPricesToUpdate = await productVariantPriceUpdateStrategy.onPriceDeleted(
                ctx,
                variantPrice,
                allPrices,
            );
            if (additionalPricesToUpdate.length) {
                const updatedAdditionalPrices = await this.connection
                    .getRepository(ctx, ProductVariantPrice)
                    .save(additionalPricesToUpdate);
                await this.eventBus.publish(
                    new ProductVariantPriceEvent(ctx, updatedAdditionalPrices, 'updated'),
                );
            }
        }
    }

    async softDelete(ctx: RequestContext, id: ID | ID[]): Promise<DeletionResponse> {
        const ids = Array.isArray(id) ? id : [id];
        const variants = await this.connection
            .getRepository(ctx, ProductVariant)
            .find({ where: { id: In(ids) } });
        for (const variant of variants) {
            variant.deletedAt = new Date();
        }
        await this.connection.getRepository(ctx, ProductVariant).save(variants, { reload: false });
        await this.eventBus.publish(new ProductVariantEvent(ctx, variants, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * This method is intended to be used by the ProductVariant GraphQL entity resolver to resolve the
     * price-related fields which need to be populated at run-time using the `applyChannelPriceAndTax`
     * method.
     *
     * Is optimized to make as few DB calls as possible using caching based on the open request.
     */
    async hydratePriceFields<F extends 'currencyCode' | 'price' | 'priceWithTax' | 'taxRateApplied'>(
        ctx: RequestContext,
        variant: ProductVariant,
        priceField: F,
    ): Promise<ProductVariant[F]> {
        const cacheKey = `hydrate-variant-price-fields-${variant.id}`;
        let populatePricesPromise = this.requestCache.get<Promise<ProductVariant>>(ctx, cacheKey);

        if (!populatePricesPromise) {
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            populatePricesPromise = new Promise(async (resolve, reject) => {
                try {
                    if (!variant.productVariantPrices?.length) {
                        const variantWithPrices = await this.connection.getEntityOrThrow(
                            ctx,
                            ProductVariant,
                            variant.id,
                            { relations: ['productVariantPrices'], includeSoftDeleted: true },
                        );
                        variant.productVariantPrices = variantWithPrices.productVariantPrices;
                    }
                    if (!variant.taxCategory) {
                        const variantWithTaxCategory = await this.connection.getEntityOrThrow(
                            ctx,
                            ProductVariant,
                            variant.id,
                            { relations: ['taxCategory'], includeSoftDeleted: true },
                        );
                        variant.taxCategory = variantWithTaxCategory.taxCategory;
                    }
                    resolve(await this.applyChannelPriceAndTax(variant, ctx, undefined, true));
                } catch (e: any) {
                    reject(e);
                }
            });
            this.requestCache.set(ctx, cacheKey, populatePricesPromise);
        }
        const hydratedVariant = await populatePricesPromise;
        return hydratedVariant[priceField];
    }

    /**
     * @description
     * Given an array of ProductVariants from the database, this method will apply the correct price and tax
     * and translate each item.
     */
    private async applyPricesAndTranslateVariants(
        ctx: RequestContext,
        variants: ProductVariant[],
    ): Promise<Array<Translated<ProductVariant>>> {
        return await Promise.all(
            variants.map(async variant => {
                const variantWithPrices = await this.applyChannelPriceAndTax(variant, ctx);
                return this.translator.translate(variantWithPrices, ctx, [
                    'options',
                    'facetValues',
                    ['facetValues', 'facet'],
                ]);
            }),
        );
    }

    /**
     * @description
     * Populates the `price` field with the price for the specified channel.
     */
    async applyChannelPriceAndTax(
        variant: ProductVariant,
        ctx: RequestContext,
        order?: Order,
        throwIfNoPriceFound = false,
    ): Promise<ProductVariant> {
        return this.productPriceApplicator.applyChannelPriceAndTax(variant, ctx, order, throwIfNoPriceFound);
    }

    /**
     * @description
     * Assigns the specified ProductVariants to the specified Channel. In doing so, it will create a new
     * {@link ProductVariantPrice} and also assign the associated Product and any Assets to the Channel too.
     */
    async assignProductVariantsToChannel(
        ctx: RequestContext,
        input: AssignProductVariantsToChannelInput,
    ): Promise<Array<Translated<ProductVariant>>> {
        const hasPermission = await this.roleService.userHasPermissionOnChannel(
            ctx,
            input.channelId,
            Permission.UpdateCatalog,
        );
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: {
                id: In(input.productVariantIds),
            },
            relations: ['taxCategory', 'assets'],
        });
        const priceFactor = input.priceFactor != null ? input.priceFactor : 1;
        const targetChannel = await this.connection.getEntityOrThrow(ctx, Channel, input.channelId);
        for (const variant of variants) {
            if (variant.deletedAt) {
                continue;
            }
            await this.applyChannelPriceAndTax(variant, ctx);
            await this.channelService.assignToChannels(ctx, Product, variant.productId, [input.channelId]);
            await this.channelService.assignToChannels(ctx, ProductVariant, variant.id, [input.channelId]);
            const price = targetChannel.pricesIncludeTax ? variant.priceWithTax : variant.price;
            await this.createOrUpdateProductVariantPrice(
                ctx,
                variant.id,
                roundMoney(price * priceFactor),
                input.channelId,
                targetChannel.defaultCurrencyCode,
            );
            const assetIds = variant.assets?.map(a => a.assetId) || [];
            await this.assetService.assignToChannel(ctx, { channelId: input.channelId, assetIds });
        }
        const result = await this.findByIds(
            ctx,
            variants.map(v => v.id),
        );
        for (const variant of variants) {
            await this.eventBus.publish(
                new ProductVariantChannelEvent(ctx, variant, input.channelId, 'assigned'),
            );
        }
        return result;
    }

    async removeProductVariantsFromChannel(
        ctx: RequestContext,
        input: RemoveProductVariantsFromChannelInput,
    ): Promise<Array<Translated<ProductVariant>>> {
        const hasPermission = await this.roleService.userHasPermissionOnChannel(
            ctx,
            input.channelId,
            Permission.UpdateCatalog,
        );
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        const variants = await this.connection
            .getRepository(ctx, ProductVariant)
            .find({ where: { id: In(input.productVariantIds) } });
        for (const variant of variants) {
            await this.channelService.removeFromChannels(ctx, ProductVariant, variant.id, [input.channelId]);
            await this.connection.getRepository(ctx, ProductVariantPrice).delete({
                channelId: input.channelId,
                variant: { id: variant.id },
            });
            // If none of the ProductVariants is assigned to the Channel, remove the Channel from Product
            const productVariants = await this.connection.getRepository(ctx, ProductVariant).find({
                where: {
                    productId: variant.productId,
                },
                relations: ['channels'],
            });
            const productChannelsFromVariants = ([] as Channel[]).concat(
                ...productVariants.map(pv => pv.channels),
            );
            if (!productChannelsFromVariants.find(c => c.id === input.channelId)) {
                await this.channelService.removeFromChannels(ctx, Product, variant.productId, [
                    input.channelId,
                ]);
            }
        }
        const result = await this.findByIds(
            ctx,
            variants.map(v => v.id),
        );
        // Publish the events at the latest possible stage to decrease the chance of race conditions
        // whereby an event listener triggers a query which does not yet have access to the changes
        // within the current transaction.
        for (const variant of variants) {
            await this.eventBus.publish(
                new ProductVariantChannelEvent(ctx, variant, input.channelId, 'removed'),
            );
        }
        return result;
    }

    private async validateVariantOptionIds(
        ctx: RequestContext,
        productId: ID,
        optionIds: ID[] = [],
        isUpdateOperation?: boolean,
    ) {
        // this could be done with fewer queries but depending on the data, node will crash
        // https://github.com/vendurehq/vendure/issues/328
        const optionGroups = (
            await this.connection.getEntityOrThrow(ctx, Product, productId, {
                channelId: ctx.channelId,
                relations: ['optionGroups', 'optionGroups.options'],
                loadEagerRelations: false,
            })
        ).optionGroups;

        const activeOptions = optionGroups && optionGroups.filter(group => !group.deletedAt);

        if (optionIds.length !== activeOptions.length) {
            this.throwIncompatibleOptionsError(optionGroups);
        }
        if (
            !samplesEach(
                optionIds,
                activeOptions.map(g => g.options.map(o => o.id)),
            )
        ) {
            this.throwIncompatibleOptionsError(optionGroups);
        }

        const product = await this.connection.getEntityOrThrow(ctx, Product, productId, {
            channelId: ctx.channelId,
            relations: ['variants', 'variants.options'],
            loadEagerRelations: true,
        });

        const inputOptionIds = this.sortJoin(optionIds, ',');

        product.variants
            .filter(v => !v.deletedAt)
            .forEach(variant => {
                const variantOptionIds = this.sortJoin(variant.options, ',', 'id');
                if (isUpdateOperation) return;
                if (variantOptionIds === inputOptionIds) {
                    throw new UserInputError('error.product-variant-options-combination-already-exists', {
                        variantName: this.translator.translate(variant, ctx).name,
                    });
                }
            });
    }

    private throwIncompatibleOptionsError(optionGroups: ProductOptionGroup[]) {
        throw new UserInputError('error.product-variant-option-ids-not-compatible', {
            groupNames: this.sortJoin(optionGroups, ', ', 'code'),
        });
    }

    private sortJoin<T>(arr: T[], glue: string, prop?: keyof T): string {
        return arr
            .map(x => (prop ? x[prop] : x))
            .sort()
            .join(glue);
    }

    private async getTaxCategoryForNewVariant(
        ctx: RequestContext,
        taxCategoryId: ID | null | undefined,
    ): Promise<TaxCategory> {
        let taxCategory: TaxCategory;
        if (taxCategoryId) {
            taxCategory = await this.connection.getEntityOrThrow(ctx, TaxCategory, taxCategoryId);
        } else {
            const taxCategories = await this.taxCategoryService.findAll(ctx);
            taxCategory = taxCategories.items.find(t => t.isDefault === true) ?? taxCategories.items[0];
        }
        if (!taxCategory) {
            // there is no TaxCategory set up, so create a default
            taxCategory = await this.taxCategoryService.create(ctx, { name: 'Standard Tax' });
        }
        return taxCategory;
    }
}
