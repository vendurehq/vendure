import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { PriceCalculationResult } from '../../common/types/common-types';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductVariantService } from '../../service/services/product-variant.service';

import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

/**
 * @description
 * The default {@link OrderItemPriceCalculationStrategy}. It returns the unit price that the configured
 * {@link ProductVariantShopperPriceStrategy} calculates for the Customer of the Order, with the OrderLine
 * custom fields as the pricing data. With the {@link DefaultProductVariantShopperPriceStrategy}, this is
 * the price of the ProductVariant.
 *
 * It uses `ProductVariantService.calculateShopperPriceForOrder()`, so it must be initialized with `init()`
 * before use. Vendure does this for the configured strategy.
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
    ): Promise<PriceCalculationResult> {
        return this.productVariantService.calculateShopperPriceForOrder(
            ctx,
            productVariant,
            order,
            quantity,
            orderLineCustomFields,
        );
    }
}
