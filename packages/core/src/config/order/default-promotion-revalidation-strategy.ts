import { ModifyOrderInput } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';

import { PromotionRevalidationStrategy } from './promotion-revalidation-strategy';

/**
 * @description
 * The default {@link PromotionRevalidationStrategy}. It follows the `freezePromotions` option of
 * the `modifyOrder` mutation input: the Promotions are frozen when the option is `true` and
 * re-validated otherwise, which preserves the behaviour of Vendure prior to v3.8.0 for every
 * caller that does not pass the option.
 *
 * @docsCategory orders
 * @docsPage PromotionRevalidationStrategy
 * @since 3.8.0
 */
export class DefaultPromotionRevalidationStrategy implements PromotionRevalidationStrategy {
    shouldRevalidatePromotions(ctx: RequestContext, order: Order, input: ModifyOrderInput): boolean {
        return input.options?.freezePromotions !== true;
    }
}
