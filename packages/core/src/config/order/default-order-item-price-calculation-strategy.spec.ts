import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
// Loads the service before the config, as the application does, to avoid a circular import
import '../../service/services/shopper-identity.service';
import { ProductVariantShopperPriceArgs } from '../catalog/product-variant-shopper-price-strategy';
import { ConfigService } from '../config.service';
import { composeStrategy } from '../strategy-layer/compose-strategy';
import { StrategyLayer } from '../strategy-layer/strategy-layer';

import { DefaultOrderItemPriceCalculationStrategy } from './default-order-item-price-calculation-strategy';
import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

class UnitCodeLayer extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
    static priority = 100;

    async getShopperPriceData(
        ctx: RequestContext,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
    ) {
        const data = await this.inner.getShopperPriceData?.(ctx, orderLineCustomFields, order);
        return { ...data, unitCode: orderLineCustomFields.unitCode };
    }
}

async function calculate(layered: boolean) {
    const calls: Array<{ args: ProductVariantShopperPriceArgs; customerId: unknown }> = [];
    let scopedCustomerId: unknown;
    const base = new DefaultOrderItemPriceCalculationStrategy();
    const strategy = layered ? composeStrategy(UnitCodeLayer, base) : base;
    const configService = {
        orderOptions: { orderItemPriceCalculationStrategy: strategy },
        catalogOptions: {
            productVariantShopperPriceStrategy: {
                calculateUnitPrice: (
                    ctx: RequestContext,
                    variant: ProductVariant,
                    args: ProductVariantShopperPriceArgs,
                ) => {
                    calls.push({ args, customerId: scopedCustomerId });
                    return { price: variant.listPrice, priceIncludesTax: false };
                },
            },
        },
    };
    const shopperIdentityService = {
        runForCustomer: (ctx: RequestContext, customerId: unknown, fn: () => Promise<unknown>) => {
            scopedCustomerId = customerId;
            return fn();
        },
    };
    const injector = {
        get: (token: unknown) => (token === ConfigService ? configService : shopperIdentityService),
    } as unknown as Injector;
    base.init(injector);

    const result = await strategy.calculateUnitPrice(
        RequestContext.empty(),
        new ProductVariant({ listPrice: 500 }),
        { unitCode: 'BOX' },
        new Order({ customerId: 42 }),
        3,
    );
    return { result, calls };
}

describe('DefaultOrderItemPriceCalculationStrategy', () => {
    it('passes no pricing data when no layer gives it, and runs for the customer of the order', async () => {
        const { result, calls } = await calculate(false);

        expect(result).toEqual({ price: 500, priceIncludesTax: false });
        expect(calls).toEqual([{ args: { quantity: 3, data: undefined }, customerId: 42 }]);
    });

    it('passes the pricing data of a layer over the configured chain', async () => {
        const { calls } = await calculate(true);

        expect(calls).toEqual([{ args: { quantity: 3, data: { unitCode: 'BOX' } }, customerId: 42 }]);
    });
});
