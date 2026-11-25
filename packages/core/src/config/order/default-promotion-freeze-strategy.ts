import { ModifyOrderInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { changesLinesCouponsOrShipping } from '../../service/helpers/utils/modify-order-changes';

import { PromotionFreezeStrategy } from './promotion-freeze-strategy';

/**
 * @description
 * The default {@link PromotionFreezeStrategy}.
 *
 * When the `freezePromotions` option of the `modifyOrder` input is set, it is followed. Otherwise
 * the Promotions are frozen unless the modification changes what is being bought or how it is
 * discounted: adding items, adjusting OrderLines, changing the coupon codes or selecting shipping
 * methods re-tests the Promotions. Any other modification, such as an address change, a
 * surcharge, a note or custom fields, leaves the discounts as the customer paid them.
 *
 * @docsCategory orders
 * @docsPage PromotionFreezeStrategy
 * @since 4.0.0
 */
export class DefaultPromotionFreezeStrategy implements PromotionFreezeStrategy {
    shouldFreezePromotions(ctx: RequestContext, order: Order, input: ModifyOrderInput): boolean {
        const explicit = input.options?.freezePromotions;
        if (explicit != null) {
            return explicit;
        }
        return !changesLinesCouponsOrShipping(order, input);
    }
}
