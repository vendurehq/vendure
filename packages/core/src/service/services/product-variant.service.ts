import { Injectable } from '@nestjs/common';
import { BuyerPrice } from '@vendure/common/lib/generated-shop-types';
import {
    AssignProductVariantsToChannelInput,
    CreateProductVariantInput,
    CurrencyCode,
    DeletionResponse,
    DeletionResult,
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
import {
    EntityNotFoundError,
    ForbiddenError,
    NoBuyerPriceError,
    UserInputError,
} from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { roundMoney } from '../../common/round-money';
import { ListQueryOptions, PriceCalculationResult } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { idsAreEqual } from '../../common/utils';
import { Buyer } from '../../config/catalog/product-variant-buyer-price-strategy';
import { UpdatedProductVariantPrice } from '../../config/catalog/product-variant-price-update-strategy';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import {
    Channel,
    Order,
    OrderLine,
    ProductOptionGroup,
    ProductVariantPrice,
    StockLevel,
    StockLocation,
    TaxCategory,
} from '../../entity';
import { FacetValue } from '../../entity/facet-value/facet-value.entity';
import { ProductOption } from '../../entity/product-option/product-option.entity';
import { ProductVariantTranslation } from '../../entity/product-variant/product-variant-translation.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductTranslation } from '../../entity/product/product-translation.entity';
import { Product } from '../../entity/product/product.entity';
import { EventBus } from '../../event-bus/event-bus';
import { ProductVariantChannelEvent } from '../../event-bus/events/product-variant-channel-event';
import { ProductVariantEvent } from '../../event-bus/events/product-variant-event';
import { ProductVariantPriceEvent } from '../../event-bus/events/product-variant-price-event';
import { ChannelEnabledChecker } from '../helpers/channel-enabled-checker/channel-enabled-checker';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { ProductPriceApplicator } from '../helpers/product-price-applicator/product-price-applicator';
import { SlugValidator } from '../helpers/slug-validator/slug-validator';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { patchEntity } from '../helpers/utils/patch-entity';
import { samplesEach } from '../helpers/utils/samples-each';

import { AssetService } from './asset.service';
import { BuyerIdentityService } from './buyer-identity.service';
import { ChannelService } from './channel.service';
import { FacetValueService } from './facet-value.service';
import { GlobalSettingsService } from './global-settings.service';
import { RoleService } from './role.service';
import { StockLevelReadOptions, StockLevelService } from './stock-level.service';
import { StockMovementService } from './stock-movement.service';
import { TaxCategoryService } from './tax-category.service';

/**
 * @description
 * The options of `ProductVariantService.calculateBuyerPrice()`.
 *
 * @docsCategory services
 * @since 4.0.0
 */
export interface BuyerPriceOptions {
    /**
     * @description
     * A positive integer.
     *
     * @default 1
     */
    quantity?: number;
    /**
     * @description
     * The pricing data, for example the values that the storefront passes as OrderLine custom fields
     * to `addItemToOrder`. The strategy receives a copy.
     */
    data?: Record<string, unknown>;
    /**
     * @description
     * Who the price is for. Defaults to the Buyer of the active User, see
     * `BuyerIdentityService.forActiveUser()`.
     */
    buyer?: Buyer;
}

/**
 * @description
 * The options of `ProductVariantService.calculateBuyerPriceForOrder()`.
 *
 * @docsCategory services
 * @since 4.0.0
 */
export interface BuyerPriceForOrderOptions {
    /**
     * @description
     * The quantity of the OrderLine.
     */
    quantity: number;
    /**
     * @description
     * The custom fields of the OrderLine. The strategy receives a shallow copy as the `data` argument.
     */
    orderLineCustomFields: { [key: string]: any };
    /**
     * @description
     * Who the price is for. Defaults to the Buyer of the Customer of the Order, see
     * `BuyerIdentityService.forCustomer()`. An {@link OrderItemPriceCalculationStrategy} can pass its
     * own Buyer, for example the Customer of a company for a shared cart.
     */
    buyer?: Buyer;
}

/**
 * @description
 * The result of `ProductVariantService.calculateBuyerPrice()`: the price for the GraphQL `BuyerPrice`
 * type, and the `metadata` of the {@link ProductVariantBuyerPriceStrategy} result.
 *
 * @docsCategory services
 * @since 4.0.0
 */
export type BuyerPriceResult = BuyerPrice & { metadata?: Record<string, unknown> };

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
        private slugValidator: SlugValidator,
        private buyerIdentityService: BuyerIdentityService,
        private channelEnabledChecker: ChannelEnabledChecker,
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
                // For the Admin API `enabledInChannel` field of each item
                loadChannelAssignment: ctx.apiType === 'admin',
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
            // Not selected: the join is only here to constrain the query to one Product. Selecting
            // it would populate `productvariant.product` with a Product carrying none of its own
            // relations, which then takes precedence over the fully-loaded one when `product` is
            // among the requested relations.
            .innerJoin('productvariant.product', 'product', 'product.id = :productId', {
                productId,
            });

        if (ctx.apiType === 'shop') {
            // Also restricts the query to the active Channel
            this.channelEnabledChecker.applyToQuery(ctx, qb, ProductVariant);
        } else {
            qb.innerJoinAndSelect('productvariant.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            });
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
        const isShop = ctx.apiType === 'shop';
        const qb = this.listQueryBuilder
            .build(ProductVariant, options, {
                relations: unique([...relations, 'taxCategory']),
                // In the Shop API, the per-channel enabled check below restricts the query to the
                // active Channel, so the ListQueryBuilder does not need to join it as well
                channelId: isShop ? undefined : ctx.channelId,
                ctx,
            })
            .leftJoin('productvariant.collections', 'collection')
            .leftJoin('productvariant.product', 'product')
            .andWhere('product.deletedAt IS NULL')
            .andWhere('productvariant.deletedAt IS NULL')
            .andWhere('collection.id = :collectionId', { collectionId });

        if (isShop) {
            // Both the Product and the variant must be available in the active Channel
            this.channelEnabledChecker.applyToQuery(ctx, qb, Product, 'product');
            this.channelEnabledChecker.applyToQuery(ctx, qb, ProductVariant);
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
     *
     * Pass `{ lockStockLevels: true }` when the result is used to decide whether stock may be
     * allocated. This holds a write lock on the StockLevel rows until the surrounding
     * transaction commits, so that two concurrent checkouts cannot both pass the check and
     * then both allocate the same units. See {@link StockLevelService.getAvailableStock}.
     *
     * @since 3.7.4 - Added the `options` parameter
     */
    async getSaleableStockLevel(
        ctx: RequestContext,
        variant: ProductVariant,
        options?: StockLevelReadOptions,
    ): Promise<number> {
        const { outOfStockThreshold } = await this.globalSettingsService.getSettings(ctx);
        const available = await this.stockLevelService.getAvailableStock(ctx, variant.id, {
            ...options,
            productVariant: variant,
        });
        const { stockOnHand, stockAllocated } = available;
        if (await this.stockLevelService.hasUntrackedStock(ctx, variant, available)) {
            return Number.MAX_SAFE_INTEGER;
        }
        const effectiveOutOfStockThreshold = variant.useGlobalOutOfStockThreshold
            ? outOfStockThreshold
            : variant.outOfStockThreshold;

        return stockOnHand - stockAllocated - effectiveOutOfStockThreshold;
    }

    private async getOutOfStockThreshold(ctx: RequestContext, variant: ProductVariant): Promise<number> {
        const { outOfStockThreshold } = await this.globalSettingsService.getSettings(ctx);

        const inventoryNotTracked = !(await this.stockLevelService.isInventoryTracked(ctx, variant));
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
        const available = await this.stockLevelService.getAvailableStock(ctx, variant.id, {
            productVariant: variant,
        });
        const { stockOnHand } = available;
        if (await this.stockLevelService.hasUntrackedStock(ctx, variant, available)) {
            return Number.MAX_SAFE_INTEGER;
        }
        return stockOnHand;
    }

    async create(
        ctx: RequestContext,
        input: CreateProductVariantInput[],
    ): Promise<Array<Translated<ProductVariant>>> {
        const ids: ID[] = [];
        // No up-front stock lock here, unlike `update()`: each variant is created in this loop, so
        // its StockLevel rows do not exist until `createSingle` inserts them and no other
        // transaction can be holding them. The ids are not even known before the loop runs.
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
        // Lock every variant whose stock this call adjusts before the loop below touches any of it.
        // The loop visits the variants in input order, and a bulk update can share variants with a
        // concurrent settlement or order modification; taking the locks up front in the shared
        // order is what stops the two from deadlocking. Untracked variants are included because the
        // adjustment derives its delta from the current `stockOnHand` either way.
        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            input.filter(i => i.stockOnHand != null || i.stockLevels).map(i => i.id),
            { includeUntrackedVariants: true },
        );
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
        // optionIds is nullable in the GraphQL input, so it can arrive as null. Both checks
        // below read its length, so normalise it first.
        input.optionIds ??= [];
        await this.validateVariantOptionIds(ctx, input.productId, input.optionIds);
        await this.assertOptionCombinationIsUnused(ctx, input.productId, input.optionIds);
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
        await this.channelEnabledChecker.updateEnabledInChannel(
            ctx,
            ProductVariant,
            createdVariant.id,
            input,
        );
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
        // Seed a StockLevel for the current channel's stock locations (idempotent), so that for a
        // variant created directly within a non-default channel the channel-filtered `stockLevels`
        // field resolves to a real entry rather than an empty array until stock is first adjusted.
        await this.ensureStockLevelsForChannel(ctx, [createdVariant.id], ctx.channelId);

        // Assign the new variant to any other channels the parent product is already assigned to,
        // so that the variant is visible in all channels the product belongs to.
        // We reuse assignProductVariantsToChannel which handles permissions, pricing
        // (pricesIncludeTax + defaultCurrencyCode), stock-level seeding, asset assignment,
        // option and option group assignment, and ProductVariantChannelEvent — matching the flow in
        // ProductService.assignProductsToChannel().
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: input.productId },
            relations: { channels: true },
            relationLoadStrategy: 'query',
            loadEagerRelations: false,
        });
        if (product) {
            const additionalChannelIds = product.channels
                .map(c => c.id)
                .filter(id => !idsAreEqual(id, ctx.channelId) && !idsAreEqual(id, defaultChannel.id));

            for (const additionalChannelId of additionalChannelIds) {
                await this.assignProductVariantsToChannel(ctx, {
                    productVariantIds: [createdVariant.id],
                    channelId: additionalChannelId,
                });
            }
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
            await this.validateVariantOptionIds(ctx, existingVariant.productId, input.optionIds);
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
        await this.channelEnabledChecker.updateEnabledInChannel(
            ctx,
            ProductVariant,
            updatedVariant.id,
            input,
        );
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

    /**
     * @description
     * Soft-deletes the ProductVariant(s) with the given id(s).
     *
     * The lookup is scoped to the active Channel, so an id which does not belong to
     * `ctx.channelId` throws an {@link EntityNotFoundError}. Previously an unknown or
     * out-of-channel id was silently reported as deleted.
     *
     * @param checkChannel - Set to `false` only for trusted internal cascades which have
     * already verified the parent entity's Channel, such as `ProductService.softDelete`.
     * A global Product deletion must reach every one of its variants, including any which
     * were individually removed from the active Channel.
     */
    async softDelete(
        ctx: RequestContext,
        id: ID | ID[],
        checkChannel: boolean = true,
    ): Promise<DeletionResponse> {
        const ids = Array.isArray(id) ? id : [id];
        let variants: ProductVariant[];
        if (checkChannel) {
            variants = await this.connection.findByIdsInChannel(ctx, ProductVariant, ids, ctx.channelId, {});
            const missingId = ids.find(candidate => !variants.some(v => idsAreEqual(v.id, candidate)));
            if (missingId != null) {
                throw new EntityNotFoundError('ProductVariant', missingId);
            }
        } else {
            variants = await this.connection
                .getRepository(ctx, ProductVariant)
                .find({ where: { id: In(ids) } });
        }
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
        const hydratedVariant = await this.getVariantWithPrices(ctx, variant);
        return hydratedVariant[priceField];
    }

    /**
     * @description
     * Calculates the unit price of the ProductVariant for a buyer, the given quantity and the given
     * pricing data, without an Order. It applies the Channel price and tax (as for the `price` and
     * `priceWithTax` fields), and then runs the configured {@link ProductVariantBuyerPriceStrategy}.
     * The buyer is the `buyer` option, or else the Buyer of the active User from the
     * {@link BuyerIdentityService}.
     *
     * Returns `undefined` if the variant or its Product is not available in the active Channel (see
     * {@link ChannelEnabledChecker}). Then the strategy does not run. It also returns `undefined` if
     * the strategy gives no price for this buyer. The result has the `metadata`
     * of the strategy result. It is not a field of the GraphQL `BuyerPrice` type, but a field resolver
     * of a plugin can read it from the parent object.
     *
     * The result is the base unit price of the buyer, not a guarantee of the final cart price. The tax
     * rate comes from the tax zone of the active session, and the cart uses the tax zone of the Order.
     *
     * The strategy receives a copy of the variant and of the data, so the given objects do not change.
     * Vendure does not cache the result: the strategy runs on each call.
     *
     * @since 4.0.0
     */
    async calculateBuyerPrice(
        ctx: RequestContext,
        variant: ProductVariant,
        options: BuyerPriceOptions = {},
    ): Promise<BuyerPriceResult | undefined> {
        const { quantity = 1, data, buyer = this.buyerIdentityService.forActiveUser(ctx) } = options;
        if (!Number.isInteger(quantity) || quantity < 1) {
            throw new UserInputError('error.buyer-price-quantity-must-be-positive');
        }
        if (!(await this.isAvailableInActiveChannel(ctx, variant))) {
            return undefined;
        }
        const hydratedVariant = await this.getVariantWithPrices(ctx, variant);
        const { productVariantBuyerPriceStrategy } = this.configService.catalogOptions;
        const result = await productVariantBuyerPriceStrategy.calculateUnitPrice(
            ctx,
            new ProductVariant(hydratedVariant),
            { quantity, data: structuredClone(data), buyer },
        );
        if (!result) {
            return undefined;
        }
        const { price, priceIncludesTax, metadata } = result;
        const taxRate = hydratedVariant.taxRateApplied;
        return {
            price: roundMoney(priceIncludesTax ? taxRate.netPriceOf(price) : price),
            priceWithTax: roundMoney(priceIncludesTax ? price : taxRate.grossPriceOf(price)),
            metadata,
        };
    }

    /**
     * @description
     * Calculates the unit price of an OrderLine with the configured {@link ProductVariantBuyerPriceStrategy},
     * for a buyer of the Order. The {@link DefaultOrderItemPriceCalculationStrategy} uses this method.
     * A custom {@link OrderItemPriceCalculationStrategy} that replaces the default calls it too, so that the
     * cart and the Shop API `ProductVariant.buyerPrice` field use the same strategy and the same buyer.
     *
     * The `productVariant` must have the Channel price and tax applied, as the
     * OrderItemPriceCalculationStrategy receives it. The strategy receives the `buyer` option, or else the
     * Buyer of the Customer of the Order, and the OrderLine custom fields as the `data` argument. It
     * receives a copy of the variant and a shallow copy of the custom fields, so the given objects do not
     * change. The result includes the `metadata` of the strategy.
     *
     * If the strategy gives no price for this buyer, this method throws a {@link NoBuyerPriceError}. Then
     * Vendure does not add a new OrderLine, and an OrderLine that is already in the Order keeps its
     * current price.
     *
     * @since 4.0.0
     */
    async calculateBuyerPriceForOrder(
        ctx: RequestContext,
        productVariant: ProductVariant,
        order: Order,
        options: BuyerPriceForOrderOptions,
    ): Promise<PriceCalculationResult> {
        const {
            quantity,
            orderLineCustomFields,
            buyer = this.buyerIdentityService.forCustomer(ctx, order.customerId),
        } = options;
        const { productVariantBuyerPriceStrategy } = this.configService.catalogOptions;
        const result = await productVariantBuyerPriceStrategy.calculateUnitPrice(
            ctx,
            new ProductVariant(productVariant),
            {
                quantity,
                data: { ...orderLineCustomFields },
                buyer,
            },
        );
        if (!result) {
            throw new NoBuyerPriceError(productVariant.id);
        }
        return result;
    }

    /**
     * The variant and its Product must be available in the active Channel, as for `addItemToOrder`.
     * The Product check runs once for each Product and request.
     */
    private async isAvailableInActiveChannel(ctx: RequestContext, variant: ProductVariant): Promise<boolean> {
        const [variantEnabled, productEnabled] = await Promise.all([
            this.channelEnabledChecker.isEnabled(ctx, ProductVariant, variant),
            this.requestCache.get(
                ctx,
                `ProductVariantService.productEnabled(${variant.productId})`,
                async () => {
                    const product =
                        variant.product ??
                        (await this.connection.getRepository(ctx, Product).findOne({
                            where: { id: variant.productId },
                            select: { id: true, enabled: true },
                            loadEagerRelations: false,
                        }));
                    return !!product && this.channelEnabledChecker.isEnabled(ctx, Product, product);
                },
            ),
        ]);
        return variantEnabled && productEnabled;
    }

    /**
     * Applies the Channel price and tax to the variant once for each request.
     */
    private getVariantWithPrices(ctx: RequestContext, variant: ProductVariant): Promise<ProductVariant> {
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
        return populatePricesPromise;
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
     * {@link ProductVariantPrice} and also assign the associated Product, any Assets, and the variant's
     * ProductOptions and their ProductOptionGroups to the Channel too.
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
        // Source entities must be visible in the active Channel (GHSA-422x-jq57-j238).
        const variants = await this.connection.findByIdsInChannel(
            ctx,
            ProductVariant,
            input.productVariantIds,
            ctx.channelId,
            {
                relations: { taxCategory: true, assets: true, options: { group: true } },
            },
        );
        const priceFactor = input.priceFactor != null ? input.priceFactor : 1;
        const targetChannel = await this.connection.getEntityOrThrow(ctx, Channel, input.channelId);
        // Assigning a variant also assigns its Product, so the Product's slug must be free there.
        await this.slugValidator.assertNoConflictsInChannel(
            ctx,
            ProductTranslation,
            unique(variants.filter(v => !v.deletedAt).map(v => v.productId)),
            input.channelId,
        );
        const assignedVariantIds: ID[] = [];
        const optionIds: ID[] = [];
        const optionGroupIds: ID[] = [];
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
            // An active variant can still reference a soft-deleted option or group.
            // assignToChannels throws on those, so they are skipped.
            for (const option of variant.options ?? []) {
                if (!option.deletedAt) {
                    optionIds.push(option.id);
                }
                if (!option.group?.deletedAt) {
                    optionGroupIds.push(option.groupId);
                }
            }
            assignedVariantIds.push(variant.id);
        }
        // One update for all variants, after assignToChannels() has copied the data of the existing
        // assignments, so that an explicit `enabledInChannel` wins
        await this.channelEnabledChecker.updateEnabledInChannel(
            ctx,
            ProductVariant,
            assignedVariantIds,
            input,
            input.channelId,
        );
        // Also assign the variants' options and their groups, matching
        // ProductService.assignProductsToChannel(). Otherwise `ProductOption.group`
        // cannot be resolved in the target channel. Variants of one product share
        // options, so the ids are de-duplicated and assigned once per call.
        await Promise.all([
            ...unique(optionGroupIds).map(id =>
                this.channelService.assignToChannels(ctx, ProductOptionGroup, id, [input.channelId]),
            ),
            ...unique(optionIds).map(id =>
                this.channelService.assignToChannels(ctx, ProductOption, id, [input.channelId]),
            ),
        ]);
        // Seed a StockLevel for each of the target channel's stock locations so that per-channel
        // inventory is usable immediately; otherwise the channel-filtered `stockLevels` field
        // resolves to `[]` in the newly-assigned channel until stock is first adjusted there.
        await this.ensureStockLevelsForChannel(ctx, assignedVariantIds, input.channelId);
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

    /**
     * Ensures a `stockOnHand: 0` StockLevel exists for each given variant at every StockLocation of
     * the given channel. Idempotent, batched and concurrency-safe: it issues a single bulk insert
     * with `orIgnore()`, so rows that already exist (unique productVariantId + stockLocationId) are
     * skipped at the DB level and never overwritten — even under concurrent assignment/create requests.
     */
    private async ensureStockLevelsForChannel(
        ctx: RequestContext,
        variantIds: ID[],
        channelId: ID,
    ): Promise<void> {
        if (variantIds.length === 0) {
            return;
        }
        const stockLocations = await this.connection
            .getRepository(ctx, StockLocation)
            .createQueryBuilder('stockLocation')
            .innerJoin('stockLocation.channels', 'channel')
            .where('channel.id = :channelId', { channelId })
            .getMany();
        if (stockLocations.length === 0) {
            return;
        }
        const newStockLevels = variantIds.flatMap(productVariantId =>
            stockLocations.map(stockLocation => ({
                productVariantId,
                stockLocationId: stockLocation.id,
                stockOnHand: 0,
                stockAllocated: 0,
            })),
        );
        await this.connection
            .getRepository(ctx, StockLevel)
            .createQueryBuilder()
            .insert()
            .values(newStockLevels)
            // Fix for MySQL and MariaDB < 10.5: updateEntity(false) prevents TypeORM from using the
            // RETURNING clause after the INSERT IGNORE, where an ignored-duplicate row reports
            // insertId 0 and the re-select would otherwise throw. The seeded ids are never used here.
            .updateEntity(false)
            .orIgnore()
            .execute();
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
        // Source entities must be visible in the active Channel (GHSA-422x-jq57-j238).
        const variants = await this.connection.findByIdsInChannel(
            ctx,
            ProductVariant,
            input.productVariantIds,
            ctx.channelId,
            {},
        );
        return this.removeVariantsFromChannel(ctx, variants, input.channelId);
    }

    /**
     * Removes the given ProductVariants from the Channel. The caller must have established that it may
     * act on these variants: this method does not check permissions and does not scope the variants to
     * the active Channel. `ProductService.removeProductsFromChannel()` calls it with the variants of a
     * Product it has already loaded in the active Channel, so that the cascade removes every variant of
     * that Product, including one which is no longer in the active Channel itself.
     *
     * The default-Channel guard lives here rather than in the public method, so that both callers keep
     * it.
     *
     * @internal
     */
    async removeVariantsFromChannel(
        ctx: RequestContext,
        variants: ProductVariant[],
        channelId: ID,
    ): Promise<Array<Translated<ProductVariant>>> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        for (const variant of variants) {
            await this.channelService.removeFromChannels(ctx, ProductVariant, variant.id, [channelId]);
            await this.connection.getRepository(ctx, ProductVariantPrice).delete({
                channelId,
                variant: { id: variant.id },
            });
            // If none of the ProductVariants is assigned to the Channel, remove the Channel from Product
            const productVariants = await this.connection.getRepository(ctx, ProductVariant).find({
                where: {
                    productId: variant.productId,
                },
                relations: { channels: true },
            });
            const productChannelsFromVariants = ([] as Channel[]).concat(
                ...productVariants.map(pv => pv.channels),
            );
            if (!productChannelsFromVariants.find(c => c.id === channelId)) {
                await this.channelService.removeFromChannels(ctx, Product, variant.productId, [channelId]);
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
            await this.eventBus.publish(new ProductVariantChannelEvent(ctx, variant, channelId, 'removed'));
        }
        return result;
    }

    /**
     * Checks that the given option ids name exactly one option from each of the Product's
     * option groups.
     */
    private async validateVariantOptionIds(ctx: RequestContext, productId: ID, optionIds: ID[]) {
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
                activeOptions.map(g => g.options.filter(o => !o.deletedAt).map(o => o.id)),
            )
        ) {
            this.throwIncompatibleOptionsError(optionGroups);
        }
    }

    /**
     * Ensures that no other ProductVariant of the Product already holds the given combination
     * of options. Call this only after {@link validateVariantOptionIds}, which is what makes an
     * empty list mean the Product has no option groups rather than a malformed input.
     */
    private async assertOptionCombinationIsUnused(ctx: RequestContext, productId: ID, optionIds: ID[]) {
        if (optionIds.length === 0) return;

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
