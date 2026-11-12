import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { PriceCalculationResult } from '../../common/types/common-types';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ShopperIdentityService } from '../../service/services/shopper-identity.service';
import { ConfigService } from '../config.service';

import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

/**
 * @description
 * The default {@link OrderItemPriceCalculationStrategy}. It returns the unit price that the configured
 * {@link ProductVariantShopperPriceStrategy} calculates for the Customer of the Order. With the
 * {@link DefaultProductVariantShopperPriceStrategy}, this is the price of the ProductVariant.
 *
 * The pricing data for the shopper price strategy comes from `getShopperPriceData()` of the configured
 * chain of OrderItemPriceCalculationStrategies. This strategy gives no data.
 *
 * @docsCategory orders
 */
export class DefaultOrderItemPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    private configService: ConfigService;
    private shopperIdentityService: ShopperIdentityService;

    init(injector: Injector) {
        this.configService = injector.get(ConfigService);
        this.shopperIdentityService = injector.get(ShopperIdentityService);
    }

    async calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
        quantity: number,
    ): Promise<PriceCalculationResult> {
        const { orderItemPriceCalculationStrategy } = this.configService.orderOptions;
        const { productVariantShopperPriceStrategy } = this.configService.catalogOptions;
        // The configured chain, so that a layer over this strategy can give the data
        const data = await orderItemPriceCalculationStrategy.getShopperPriceData?.(
            ctx,
            orderLineCustomFields,
            order,
        );
        return this.shopperIdentityService.runForCustomer(ctx, order.customerId, async () =>
            productVariantShopperPriceStrategy.calculateUnitPrice(ctx, productVariant, { quantity, data }),
        );
    }

    getShopperPriceData(): Record<string, unknown> | undefined {
        return undefined;
    }
}
