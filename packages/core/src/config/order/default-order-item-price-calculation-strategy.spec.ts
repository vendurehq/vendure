import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductVariantService } from '../../service/services/product-variant.service';
import { ProductVariantShopperPriceArgs } from '../catalog/product-variant-shopper-price-strategy';
import { composeStrategy } from '../strategy-layer/compose-strategy';
import { StrategyLayer } from '../strategy-layer/strategy-layer';

import { DefaultOrderItemPriceCalculationStrategy } from './default-order-item-price-calculation-strategy';
import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

/** A layer that changes the custom fields that it passes to the inner strategy. */
class UnitCodeLayer extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
    static priority = 100;

    calculateUnitPrice(
        ...args: Parameters<OrderItemPriceCalculationStrategy['calculateUnitPrice']>
    ): ReturnType<OrderItemPriceCalculationStrategy['calculateUnitPrice']> {
        const [ctx, variant, orderLineCustomFields, order, quantity] = args;
        return this.inner.calculateUnitPrice(
            ctx,
            variant,
            { unitCode: String(orderLineCustomFields.unitCode).toUpperCase() },
            order,
            quantity,
        );
    }
}

async function calculate(layered: boolean, orderLineCustomFields: { [key: string]: any }) {
    const calls: Array<{ args: ProductVariantShopperPriceArgs; customerId: unknown }> = [];
    let scopedCustomerId: unknown;
    const configService = {
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
    const productVariantService = Object.assign(Object.create(ProductVariantService.prototype), {
        configService,
        shopperIdentityService,
    });
    const base = new DefaultOrderItemPriceCalculationStrategy();
    base.init({ get: () => productVariantService } as unknown as Injector);
    const strategy = layered ? composeStrategy(UnitCodeLayer, base) : base;

    const result = await strategy.calculateUnitPrice(
        RequestContext.empty(),
        new ProductVariant({ listPrice: 500 }),
        orderLineCustomFields,
        new Order({ customerId: 42 }),
        3,
    );
    return { result, calls };
}

describe('DefaultOrderItemPriceCalculationStrategy', () => {
    it('passes a copy of the OrderLine custom fields as data, for the customer of the order', async () => {
        const customFields = { unitCode: 'BOX' };
        const { result, calls } = await calculate(false, customFields);

        expect(result).toEqual({ price: 500, priceIncludesTax: false });
        expect(calls).toEqual([{ args: { quantity: 3, data: { unitCode: 'BOX' } }, customerId: 42 }]);
        expect(calls[0].args.data).not.toBe(customFields);
    });

    it('passes the custom fields that an outer layer gives to it', async () => {
        const { calls } = await calculate(true, { unitCode: 'box' });

        expect(calls).toEqual([{ args: { quantity: 3, data: { unitCode: 'BOX' } }, customerId: 42 }]);
    });
});
