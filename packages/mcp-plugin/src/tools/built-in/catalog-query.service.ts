import { Injectable } from '@nestjs/common';
import { PaginatedList } from '@vendure/common/lib/shared-types';
import {
    ChannelEnabledChecker,
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
        private readonly connection: TransactionalConnection,
        private readonly configService: ConfigService,
        private readonly productVariantService: ProductVariantService,
        private readonly listQueryBuilder: ListQueryBuilder,
        private readonly translator: TranslatorService,
        private readonly channelEnabledChecker: ChannelEnabledChecker,
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

        const query = this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .innerJoin('variant.product', 'product')
            .leftJoinAndSelect('variant.productVariantPrices', 'price')
            .leftJoinAndSelect('variant.taxCategory', 'taxCategory')
            .where('variant.deletedAt IS NULL')
            .andWhere('product.deletedAt IS NULL')
            .andWhere('variant.productId IN (:...productIds)', { productIds });
        if (options.includeDisabled) {
            query.innerJoin('variant.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            });
        } else {
            // Also restricts the query to the active Channel
            this.channelEnabledChecker.applyToQuery(ctx, query, ProductVariant);
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

    // One StockLevel query for the whole page, instead of one per variant.
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

    // Mirrors ProductService.findAll, which can't take a collection filter, its where clause being fixed.
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

    // A subquery keeps paging and counting in the list builder's single statement; parameter names
    // are prefixed so they don't clash with the ones the list builder binds.
    private productIdInCollection(ctx: RequestContext, collectionId: ID) {
        const subQuery = this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('mcpVariant')
            .select('mcpVariant.productId')
            .innerJoin('mcpVariant.collections', 'mcpCollection', 'mcpCollection.id = :mcpCollectionId', {
                mcpCollectionId: collectionId,
            })
            .where('mcpVariant.deletedAt IS NULL');
        // Also restricts the subquery to the active Channel
        this.channelEnabledChecker.applyToQuery(ctx, subQuery, ProductVariant);
        return Raw(alias => `${alias} IN (${subQuery.getQuery()})`, subQuery.getParameters());
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
