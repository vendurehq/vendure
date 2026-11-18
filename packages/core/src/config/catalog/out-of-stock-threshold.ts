import type { Channel } from '../../entity/channel/channel.entity';
import type { ProductVariant } from '../../entity/product-variant/product-variant.entity';

/**
 * @description
 * Resolves the `outOfStockThreshold` of a ProductVariant: the stock level below which it may not
 * be sold. A variant with `useGlobalOutOfStockThreshold` takes it from the Channel, otherwise it
 * uses its own `outOfStockThreshold`.
 *
 * Pass the Channel the request (or Order) belongs to. `GlobalSettings.outOfStockThreshold` is no
 * longer consulted from v4.0. Its value is copied to every Channel by the v4 migration.
 *
 * @docsCategory products & stock
 * @since 4.0.0
 */
export function resolveOutOfStockThreshold(
    variant: Pick<ProductVariant, 'useGlobalOutOfStockThreshold' | 'outOfStockThreshold'>,
    channel: Pick<Channel, 'outOfStockThreshold'>,
): number {
    return variant.useGlobalOutOfStockThreshold ? channel.outOfStockThreshold : variant.outOfStockThreshold;
}
