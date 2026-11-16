import { RequestContext } from '../../../api/common/request-context';
import { NoBuyerPriceError } from '../../../common/error/errors';
import { PriceCalculationResult } from '../../../common/types/common-types';
import { OrderItemPriceCalculationStrategy } from '../../../config/order/order-item-price-calculation-strategy';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';

/**
 * Calculates the unit price of an OrderLine with the OrderItemPriceCalculationStrategy. Every path that
 * prices OrderLines uses this function, so that one rule applies to a line with no buyer price:
 *
 * * A new line with no price is not added: the {@link NoBuyerPriceError} is thrown.
 * * A line that is already in the Order keeps its current price: the function returns `undefined`.
 * * After a currency change, the current price is in the old currency, so the error is thrown.
 *
 * `variant` must have the Channel price and tax applied.
 */
export async function calculateOrderLineUnitPrice(
    ctx: RequestContext,
    strategy: OrderItemPriceCalculationStrategy,
    order: Order,
    orderLine: OrderLine,
    variant: ProductVariant,
    options: { isNewLine: boolean; currencyChanged: boolean },
): Promise<PriceCalculationResult | undefined> {
    try {
        return await strategy.calculateUnitPrice(
            ctx,
            variant,
            orderLine.customFields || {},
            order,
            orderLine.quantity,
        );
    } catch (e) {
        if (e instanceof NoBuyerPriceError && !options.isNewLine && !options.currencyChanged) {
            return undefined;
        }
        throw e;
    }
}
