import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';

import { OrderRecalculationStrategy } from './order-recalculation-strategy';

/**
 * @description
 * An {@link OrderRecalculationStrategy} which recalculates an active Order when the time since its
 * last recalculation exceeds the configured `ttlMs`. This mirrors the "price freeze period" model
 * used by other e-commerce platforms: quoted prices remain stable for a period, then refresh on the
 * next access.
 *
 * @example
 * ```ts
 * import { TtlOrderRecalculationStrategy, VendureConfig } from '@vendure/core';
 *
 * export const config: VendureConfig = {
 *   // ...
 *   orderOptions: {
 *     orderRecalculationStrategy: new TtlOrderRecalculationStrategy({ ttlMs: 5 * 60 * 1000 }),
 *   },
 * };
 * ```
 *
 * @docsCategory orders
 * @docsPage OrderRecalculationStrategy
 * @since 3.8.0
 */
export class TtlOrderRecalculationStrategy implements OrderRecalculationStrategy {
    constructor(private options: { ttlMs: number }) {}

    shouldRecalculate(ctx: RequestContext, order: Order): boolean {
        if (order.pricingUpdatedAt == null) {
            return true;
        }
        return Date.now() - order.pricingUpdatedAt.getTime() >= this.options.ttlMs;
    }
}
