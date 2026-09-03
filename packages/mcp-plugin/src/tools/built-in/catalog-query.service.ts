import { Injectable } from '@nestjs/common';
import { PaginatedList } from '@vendure/common/lib/shared-types';
import {
    ConfigService,
    ID,
    idsAreEqual,
    ListQueryBuilder,
    ListQueryOptions,
    Product,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    StockLevel,
    TransactionalConnection,
    Translated,
    TranslatorService,
} from '@vendure/core';
import { FindOptionsWhere, In, IsNull, Raw } from 'typeorm';

@Injectable()
export class McpCatalogQueryService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private productVariantService: ProductVariantService,
        private listQueryBuilder: ListQueryBuilder,
        private translator: TranslatorService,
    ) {}

    async variantsByProductId(
        ctx: RequestContext,
        productIds: ID[],
        options: { includeDisabled: boolean },
    ): Promise<Map<string, ProductVariant[]>> {
        const grouped = new Map<string, ProductVariant[]>();
        if (productIds.length === 0) {
            return grouped;
        }

        const query = this.variantsInChannel(ctx)
            .leftJoinAndSelect('variant.productVariantPrices', 'price')
            .leftJoinAndSelect('variant.taxCategory', 'taxCategory')
            .andWhere('variant.productId IN (:...productIds)', { productIds });
        if (!options.includeDisabled) {
            query.andWhere('variant.enabled = :enabled', { enabled: true });
        }
        const variants = await this.withChannelPrice(ctx, await query.getMany());
        for (const variant of variants) {
            const key = String(variant.productId);
            const group = grouped.get(key);
            if (group) {
                group.push(variant);
            } else {
                grouped.set(key, [variant]);
            }
        }
        return grouped;
    }

    /**
     * Available stock for a page of variants with one StockLevel query instead of one per variant,
     * then the configured StockLocationStrategy decides the number the same way core's
     * StockLevelService.getAvailableStock does.
     */
    async withAvailableStock(
        ctx: RequestContext,
        variants: ProductVariant[],
    ): Promise<Array<{ variant: ProductVariant; stockOnHand: number }>> {
        if (variants.length === 0) {
            return [];
        }
        const stockLevels = await this.connection.getRepository(ctx, StockLevel).find({
            where: { productVariantId: In(variants.map(variant => variant.id)) },
        });
        const { stockLocationStrategy } = this.configService.catalogOptions;
        return Promise.all(
            variants.map(async variant => {
                const { stockOnHand } = await stockLocationStrategy.getAvailableStock(
                    ctx,
                    variant.id,
                    stockLevels.filter(level => idsAreEqual(level.productVariantId, variant.id)),
                );
                return { variant, stockOnHand };
            }),
        );
    }

    /**
     * Lists products for the Shop API, optionally only those in one collection. Mirrors
     * `ProductService.findAll`, whose `where` clause is fixed and cannot take the collection filter.
     */
    async findPublicProducts(
        ctx: RequestContext,
        options: ListQueryOptions<Product>,
        collectionId?: ID,
    ): Promise<PaginatedList<Translated<Product>>> {
        const where: FindOptionsWhere<Product> = { deletedAt: IsNull() };
        if (collectionId != null) {
            where.id = this.productIdInCollection(ctx, collectionId);
        }
        const [products, totalItems] = await this.listQueryBuilder
            .build(Product, options, {
                relations: ['featuredAsset'],
                channelId: ctx.channelId,
                where,
                ctx,
            })
            .getManyAndCount();
        return {
            items: products.map(product => this.translator.translate(product, ctx)),
            totalItems,
        };
    }

    /**
     * `product.id IN (subquery)` for products with at least one enabled variant in the collection.
     * A subquery keeps paging and counting in the list builder's single statement. Parameter names
     * are prefixed so they cannot clash with the ones the list builder binds.
     */
    private productIdInCollection(ctx: RequestContext, collectionId: ID) {
        const subQuery = this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('mcpVariant')
            .select('mcpVariant.productId')
            .innerJoin('mcpVariant.collections', 'mcpCollection', 'mcpCollection.id = :mcpCollectionId', {
                mcpCollectionId: collectionId,
            })
            .innerJoin('mcpVariant.channels', 'mcpChannel', 'mcpChannel.id = :mcpChannelId', {
                mcpChannelId: ctx.channelId,
            })
            .where('mcpVariant.deletedAt IS NULL')
            .andWhere('mcpVariant.enabled = :mcpEnabled', { mcpEnabled: true });
        return Raw(alias => `${alias} IN (${subQuery.getQuery()})`, subQuery.getParameters());
    }

    private variantsInChannel(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .innerJoin('variant.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .innerJoin('variant.product', 'product')
            .where('variant.deletedAt IS NULL')
            .andWhere('product.deletedAt IS NULL');
    }

    private async withChannelPrice(
        ctx: RequestContext,
        variants: ProductVariant[],
    ): Promise<ProductVariant[]> {
        const { productVariantPriceSelectionStrategy } = this.configService.catalogOptions;
        const priced: ProductVariant[] = [];
        for (const variant of variants) {
            if (await productVariantPriceSelectionStrategy.selectPrice(ctx, variant.productVariantPrices)) {
                priced.push(variant);
            }
        }
        return Promise.all(
            priced.map(variant => this.productVariantService.applyChannelPriceAndTax(variant, ctx)),
        );
    }
}
