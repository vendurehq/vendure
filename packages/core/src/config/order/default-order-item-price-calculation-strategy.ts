import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { PriceCalculationResult } from '../../common/types/common-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Customer } from '../../entity/customer/customer.entity';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ConfigService } from '../config.service';

import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

/**
 * @description
 * The default {@link OrderItemPriceCalculationStrategy}. It returns the unit price that the configured
 * {@link ProductVariantShopperPriceStrategy} calculates for the Customer of the Order. With the
 * {@link DefaultProductVariantShopperPriceStrategy}, this is the price of the ProductVariant.
 *
 * @docsCategory orders
 */
export class DefaultOrderItemPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    private configService: ConfigService;
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.configService = injector.get(ConfigService);
        this.connection = injector.get(TransactionalConnection);
    }

    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
        quantity: number,
    ): PriceCalculationResult | Promise<PriceCalculationResult> {
        const { productVariantShopperPriceStrategy } = this.configService.catalogOptions;
        return productVariantShopperPriceStrategy.calculateUnitPrice(ctx, productVariant, {
            quantity,
            orderLineCustomFields,
            getCustomer: () => this.getCustomer(ctx, order),
        });
    }

    private async getCustomer(ctx: RequestContext, order: Order): Promise<Customer | undefined> {
        if (order.customer) {
            return order.customer;
        }
        if (order.customerId == null) {
            return undefined;
        }
        const customer = await this.connection
            .getRepository(ctx, Customer)
            .findOne({ where: { id: order.customerId } });
        return customer ?? undefined;
    }
}
