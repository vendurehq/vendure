import { ModifyOrderInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';

/**
 * @description
 * Decides whether the Promotions on an Order are re-validated when the Order is modified via the
 * `modifyOrder` mutation.
 *
 * An Order can only be modified from the `Modifying` state, which is only reachable once the
 * customer has paid or authorized payment. Re-validating the Promotions at that point means that
 * an edit which does not touch the OrderLines at all, correcting a shipping address for instance,
 * can still change what the Order costs: a Promotion may have been disabled since payment, or one
 * of its conditions may now evaluate differently.
 *
 * Returning `true` re-tests every active Promotion from scratch, which is the historical
 * behaviour. Returning `false` freezes the Promotions recorded on the Order: their conditions are
 * not re-tested, the existing Adjustments on the OrderLines and ShippingLines are preserved, and
 * only taxes, line prices and (unless `recalculateShipping` is `false`) the shipping rate are
 * re-calculated.
 *
 * The default {@link DefaultPromotionRevalidationStrategy} follows the `freezePromotions` option of
 * the mutation input, so passing `options: { freezePromotions: true }` freezes and anything else
 * re-validates.
 *
 * Freezing also makes the `couponCodes` of the modification inert as far as the price is concerned:
 * `modifyOrder` still validates them and updates `Order.couponCodes`, but no Adjustment follows.
 *
 * @example
 * ```ts
 * import { PromotionRevalidationStrategy, RequestContext, Order, VendureConfig } from '\@vendure/core';
 * import { ModifyOrderInput } from '\@vendure/common/lib/generated-types';
 *
 * // Never re-price a paid Order, whatever the client sends.
 * class FreezePaidOrderPromotionsStrategy implements PromotionRevalidationStrategy {
 *     shouldRevalidatePromotions(ctx: RequestContext, order: Order, input: ModifyOrderInput) {
 *         return false;
 *     }
 * }
 *
 * export const config: VendureConfig = {
 *     // ...
 *     orderOptions: {
 *         promotionRevalidationStrategy: new FreezePaidOrderPromotionsStrategy(),
 *     },
 * };
 * ```
 *
 * :::info
 *
 * This is configured via the `orderOptions.promotionRevalidationStrategy` property of your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 * @docsPage PromotionRevalidationStrategy
 * @docsWeight 0
 * @since 3.8.0
 */
export interface PromotionRevalidationStrategy extends InjectableStrategy {
    /**
     * @description
     * Return `true` to re-test the Promotions against the current state of the Order and the
     * Channel, or `false` to keep the Promotions and Adjustments the Order already carries.
     *
     * The `input` is the full `ModifyOrderInput`, so an implementation can decide based on what
     * the modification actually changes. Note that the `promotions` relation is not loaded on the
     * `order` passed here; `OrderModifier` loads it separately when the answer is `false`.
     *
     * An implementation must give the same answer for a dry run and for the real call which
     * follows it. `input.dryRun` is part of the input, which makes it easy to branch on by
     * accident, but a dry run exists to preview the price the modification will produce: if the
     * two calls disagree, the preview shown to the administrator is not the price the Order ends
     * up with, and the resulting payment or refund will not match what was approved.
     */
    shouldRevalidatePromotions(
        ctx: RequestContext,
        order: Order,
        input: ModifyOrderInput,
    ): boolean | Promise<boolean>;
}
