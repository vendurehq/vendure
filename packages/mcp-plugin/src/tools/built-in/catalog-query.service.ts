import { Injectable } from '@nestjs/common';
import {
    ConfigService,
    ID,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

@Injectable()
export class McpCatalogQueryService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private productVariantService: ProductVariantService,
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

    async productIdsInCollection(ctx: RequestContext, collectionId: ID): Promise<string[]> {
        const rows = await this.variantsInChannel(ctx)
            .select('DISTINCT variant.productId', 'productId')
            .innerJoin('variant.collections', 'collection', 'collection.id = :collectionId', { collectionId })
            .andWhere('variant.enabled = :enabled', { enabled: true })
            .getRawMany<{ productId: ID }>();
        return rows.map(row => String(row.productId));
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
