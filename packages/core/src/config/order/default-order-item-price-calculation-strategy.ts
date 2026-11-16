import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { PriceCalculationResult } from '../../common/types/common-types';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductVariantService } from '../../service/services/product-variant.service';
import { Buyer } from '../catalog/product-variant-buyer-price-strategy';

import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

/**
 * @description
 * The default {@link OrderItemPriceCalculationStrategy}. It returns the unit price that the configured
 * {@link ProductVariantBuyerPriceStrategy} calculates for the Customer of the Order, with the OrderLine
 * custom fields as the pricing data. If an outer layer passes `options.buyer`, the price is for that
 * {@link Buyer}. With the {@link DefaultProductVariantBuyerPriceStrategy}, this is
 * the price of the ProductVariant. The result includes the `metadata` of the buyer price strategy, so an
 * outer layer can read it from the result of `inner`.
 *
 * It uses `ProductVariantService.calculateBuyerPriceForOrder()`, so it must be initialized with `init()`
 * before use. Vendure does this for the configured strategy.
 *
 * Since v4.0.0, it is exported from `\@vendure/core`, so that a custom strategy can extend it.
 *
 * @docsCategory orders
 */
export class DefaultOrderItemPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    private productVariantService: ProductVariantService;

    init(injector: Injector) {
        this.productVariantService = injector.get(ProductVariantService);
    }

    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
        quantity: number,
        options?: { buyer?: Buyer },
    ): Promise<PriceCalculationResult> {
        return this.productVariantService.calculateBuyerPriceForOrder(ctx, productVariant, order, {
            quantity,
            orderLineCustomFields,
            buyer: options?.buyer,
        });
    }
}
