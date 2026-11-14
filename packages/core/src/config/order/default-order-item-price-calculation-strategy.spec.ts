import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { NoBuyerPriceError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { PriceCalculationResult } from '../../common/types/common-types';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductVariantService } from '../../service/services/product-variant.service';
import { Buyer, ProductVariantBuyerPriceArgs } from '../catalog/product-variant-buyer-price-strategy';
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

/** A layer that passes its own Buyer to the inner strategy. */
class CompanyBuyerLayer extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
    static priority = 200;

    calculateUnitPrice(
        ...args: Parameters<OrderItemPriceCalculationStrategy['calculateUnitPrice']>
    ): ReturnType<OrderItemPriceCalculationStrategy['calculateUnitPrice']> {
        const [ctx, variant, orderLineCustomFields, order, quantity] = args;
        return this.inner.calculateUnitPrice(ctx, variant, orderLineCustomFields, order, quantity, {
            buyer: companyBuyer,
        });
    }
}

const CHANNEL_PRICE = { price: 500, priceIncludesTax: false };

const companyBuyer = { getCustomerId: () => Promise.resolve(99) } as unknown as Buyer;

async function calculate(
    layered: boolean | typeof CompanyBuyerLayer,
    orderLineCustomFields: { [key: string]: any },
    buyerPrice: PriceCalculationResult | undefined,
    options?: { buyer?: Buyer },
) {
    const calls: Array<{ args: ProductVariantBuyerPriceArgs; customerId: unknown }> = [];
    const configService = {
        catalogOptions: {
            productVariantBuyerPriceStrategy: {
                calculateUnitPrice: async (
                    ctx: RequestContext,
                    variant: ProductVariant,
                    args: ProductVariantBuyerPriceArgs,
                ) => {
                    calls.push({ args, customerId: await args.buyer.getCustomerId() });
                    return buyerPrice;
                },
            },
        },
    };
    const buyerIdentityService = {
        forCustomer: (ctx: RequestContext, customerId: unknown) => ({
            getCustomerId: () => Promise.resolve(customerId),
        }),
    };
    const productVariantService = Object.assign(Object.create(ProductVariantService.prototype), {
        configService,
        buyerIdentityService,
    });
    const base = new DefaultOrderItemPriceCalculationStrategy();
    base.init({ get: () => productVariantService } as unknown as Injector);
    const strategy =
        layered === CompanyBuyerLayer
            ? composeStrategy(UnitCodeLayer, CompanyBuyerLayer, base)
            : layered
              ? composeStrategy(UnitCodeLayer, base)
              : base;

    const result = strategy.calculateUnitPrice(
        RequestContext.empty(),
        new ProductVariant({ id: 7, listPrice: 500 }),
        orderLineCustomFields,
        new Order({ customerId: 42 }),
        3,
        options,
    );
    return { result, calls };
}

describe('DefaultOrderItemPriceCalculationStrategy', () => {
    it('passes a copy of the OrderLine custom fields as data, for the customer of the order', async () => {
        const customFields = { unitCode: 'BOX' };
        const { result, calls } = await calculate(false, customFields, CHANNEL_PRICE);

        expect(await result).toEqual({ price: 500, priceIncludesTax: false });
        expect(calls).toEqual([
            { args: { quantity: 3, data: { unitCode: 'BOX' }, buyer: expect.any(Object) }, customerId: 42 },
        ]);
        expect(calls[0].args.data).not.toBe(customFields);
    });

    it('passes the custom fields that an outer layer gives to it', async () => {
        const { result, calls } = await calculate(true, { unitCode: 'box' }, CHANNEL_PRICE);
        await result;

        expect(calls[0].args.data).toEqual({ unitCode: 'BOX' });
    });

    it('prices for the buyer of the options and not for the customer of the order', async () => {
        const { result, calls } = await calculate(false, {}, CHANNEL_PRICE, { buyer: companyBuyer });
        await result;

        expect(calls).toHaveLength(1);
        expect(calls[0].args.buyer).toBe(companyBuyer);
        expect(calls[0].customerId).toBe(99);
    });

    it('prices for the customer of the order when the options have no buyer', async () => {
        const { result, calls } = await calculate(false, {}, CHANNEL_PRICE, {});
        await result;

        expect(calls[0].customerId).toBe(42);
    });

    it('prices for the buyer that an outer layer passes', async () => {
        const { result, calls } = await calculate(CompanyBuyerLayer, { unitCode: 'box' }, CHANNEL_PRICE);
        await result;

        expect(calls).toHaveLength(1);
        expect(calls[0].args.buyer).toBe(companyBuyer);
        expect(calls[0].args.data).toEqual({ unitCode: 'BOX' });
    });

    it('returns the metadata of the buyer price strategy', async () => {
        const buyerPrice = { price: 400, priceIncludesTax: false, metadata: { priceRule: 'TIER_10' } };
        const { result } = await calculate(false, {}, buyerPrice);

        expect(await result).toEqual(buyerPrice);
    });

    it('throws when the buyer price strategy gives no price', async () => {
        const { result } = await calculate(false, {}, undefined);

        await expect(result).rejects.toBeInstanceOf(NoBuyerPriceError);
    });
});
