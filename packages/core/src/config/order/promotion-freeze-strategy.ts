import { ModifyOrderInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';

/**
 * @description
 * Decides whether the Promotions on an Order are frozen when the Order is modified via the
 * `modifyOrder` mutation.
 *
 * An Order can only be modified from the `Modifying` state, which is only reachable once the
 * customer has paid or authorized payment. Re-testing the Promotions at that point means that an
 * edit which does not change what is being bought, correcting a shipping address for instance,
 * can still change what the Order costs: a Promotion may have been disabled since payment, or one
 * of its conditions may now evaluate differently.
 *
 * Returning `true` freezes the Promotions recorded on the Order: their conditions are not
 * re-tested, the existing Adjustments on the OrderLines and ShippingLines are kept, and only
 * taxes, line prices and (unless `recalculateShipping` is `false`) the shipping rate are
 * re-calculated. A shipping discount is capped at the new shipping price, so a cheaper rate
 * cannot make shipping negative. Units added to an existing OrderLine get no discount, because
 * the line keeps the discount amount it had.
 *
 * Returning `false` re-tests the Promotions. The candidates are the Promotions active in the
 * Channel plus the ones already on the Order, so a Promotion the customer paid with still applies
 * after it has been disabled, as long as its conditions still pass.
 *
 * The coupon codes of an Order cannot change while its Promotions are frozen, because a coupon
 * code only has an effect through its Promotion. Such a modification is rejected.
 *
 * The default {@link DefaultPromotionFreezeStrategy} follows the `freezePromotions` option of the
 * mutation input when it is set, and otherwise freezes unless the modification changes the
 * OrderLines, the coupon codes or the shipping methods.
 *
 * @example
 * ```ts
 * import { Order, PromotionFreezeStrategy, RequestContext, VendureConfig } from '\@vendure/core';
 * import { ModifyOrderInput } from '\@vendure/common/lib/generated-types';
 *
 * // Never re-price a paid Order, whatever the client sends.
 * class AlwaysFreezePromotionsStrategy implements PromotionFreezeStrategy {
 *     shouldFreezePromotions(ctx: RequestContext, order: Order, input: ModifyOrderInput) {
 *         return true;
 *     }
 * }
 *
 * export const config: VendureConfig = {
 *     // ...
 *     orderOptions: {
 *         promotionFreezeStrategy: new AlwaysFreezePromotionsStrategy(),
 *     },
 * };
 * ```
 *
 * :::info
 *
 * This is configured via the `orderOptions.promotionFreezeStrategy` property of your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 * @docsPage PromotionFreezeStrategy
 * @docsWeight 0
 * @since 4.0.0
 */
export interface PromotionFreezeStrategy extends InjectableStrategy {
    /**
     * @description
     * Return `true` to keep the Promotions and Adjustments the Order already carries, or `false`
     * to re-test the Promotions against the modified Order.
     *
     * The `order` is the Order as it is before the modification, and the `input` is the full
     * `ModifyOrderInput`, so an implementation can decide based on what the modification changes.
     * Implementations should normally honour `input.options.freezePromotions` when it is set:
     * it is how an administrator states an explicit choice, for instance in the Dashboard when a
     * modification would change the discounts.
     *
     * An implementation must give the same answer for a dry run and for the real call which
     * follows it. A dry run previews the price the modification will produce: if the two calls
     * disagree, the payment or refund will not match what the administrator approved.
     */
    shouldFreezePromotions(
        ctx: RequestContext,
        order: Order,
        input: ModifyOrderInput,
    ): boolean | Promise<boolean>;
}
