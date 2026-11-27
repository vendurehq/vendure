import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';

/** The number of variants assigned to the Channel, leaving out deleted ones. */
export function countChannelVariants(
    ctx: RequestContext,
    connection: TransactionalConnection,
    channelId: ID,
): Promise<number> {
    return connection
        .getRepository(ctx, ProductVariant)
        .createQueryBuilder('variant')
        .innerJoin('variant.channels', 'channel', 'channel.id = :channelId', { channelId })
        .where('variant.deletedAt IS NULL')
        .getCount();
}

/** The IDs of the tax categories that the Channel's variants use. */
export async function findChannelTaxCategoryIds(
    ctx: RequestContext,
    connection: TransactionalConnection,
    channelId: ID,
): Promise<ID[]> {
    const rows = await connection
        .getRepository(ctx, ProductVariant)
        .createQueryBuilder('variant')
        .innerJoin('variant.channels', 'channel', 'channel.id = :channelId', { channelId })
        .where('variant.deletedAt IS NULL')
        .select('DISTINCT variant.taxCategoryId', 'taxCategoryId')
        .getRawMany<{ taxCategoryId: ID }>();
    return rows.map(row => row.taxCategoryId).filter(id => id != null);
}

/**
 * The first enabled variant of an enabled product in the Channel that has a price in the given
 * currency, ordered by ID, so repeated checks use the same one.
 */
export async function findSampleVariant(
    ctx: RequestContext,
    connection: TransactionalConnection,
    channelId: ID,
    currencyCode: CurrencyCode,
): Promise<ProductVariant | undefined> {
    const variant = await connection
        .getRepository(ctx, ProductVariant)
        .createQueryBuilder('variant')
        .innerJoin('variant.channels', 'channel', 'channel.id = :channelId', { channelId })
        .innerJoin('variant.product', 'product')
        .innerJoin(
            'variant.productVariantPrices',
            'price',
            'price.channelId = :channelId AND price.currencyCode = :currencyCode',
            { channelId, currencyCode },
        )
        .where('variant.deletedAt IS NULL')
        .andWhere('variant.enabled = :enabled', { enabled: true })
        .andWhere('product.deletedAt IS NULL')
        .andWhere('product.enabled = :enabled', { enabled: true })
        .orderBy('variant.id', 'ASC')
        .getOne();
    return variant ?? undefined;
}
