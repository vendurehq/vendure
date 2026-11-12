import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    BuyerPriceResult,
    composeStrategy,
    OrderItemPriceCalculationStrategy,
    PluginCommonModule,
    PriceCalculationResult,
    ProductVariant,
    ProductVariantBuyerPriceArgs,
    ProductVariantBuyerPriceStrategy,
    RequestContext,
    roundMoney,
    StrategyLayer,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

export const FIXED_UNIT_PRICE = 1234;

/** The number of units in the `BOX` packaging unit. */
export const BOX_SIZE = 6;

/**
 * The email addresses of the Customers whose unit price is always {@link FIXED_UNIT_PRICE}. The test sets them.
 */
export const fixedPriceEmailAddresses = new Set<string>();

/** The metadata that {@link MetadataRecordingLayer} reads from the result of the inner strategy. */
export const orderItemMetadata: Array<Record<string, unknown> | undefined> = [];

/**
 * A layer over the {@link ProductVariantBuyerPriceStrategy}:
 *
 * * no price when the pricing data has `unitCode: 'NONE'`,
 * * a fixed unit price for some Customers,
 * * 20% off for a quantity of 10 or more,
 * * the price of {@link BOX_SIZE} units when the pricing data has `unitCode: 'BOX'`. In the cart, the
 *   pricing data is the OrderLine custom fields.
 *
 * The metadata gives the rule that applied last.
 */
export class TestBuyerPriceLayer extends StrategyLayer.passThrough<ProductVariantBuyerPriceStrategy>() {
    static priority = 100;

    async calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantBuyerPriceArgs,
    ): Promise<PriceCalculationResult | undefined> {
        if (args.data?.unitCode === 'NONE') {
            return undefined;
        }
        const result = await this.inner.calculateUnitPrice(ctx, productVariant, args);
        if (!result) {
            return undefined;
        }
        let price = result.price;
        let rule = 'CHANNEL';
        const customer = await args.buyer.getCustomer();
        if (customer && fixedPriceEmailAddresses.has(customer.emailAddress)) {
            price = FIXED_UNIT_PRICE;
            rule = 'FIXED';
        }
        if (args.quantity >= 10) {
            price = roundMoney(price * 0.8);
            rule = 'TIER_10';
        }
        if (args.data?.unitCode === 'BOX') {
            price = price * BOX_SIZE;
            rule = 'BOX';
        }
        // Writes to the variant, so that a test can check that the shared entity does not change.
        productVariant.listPrice = price;
        return { ...result, price, metadata: { rule } };
    }
}

/**
 * A layer over the {@link OrderItemPriceCalculationStrategy} that records the metadata of the inner result.
 */
export class MetadataRecordingLayer extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
    static priority = 100;

    async calculateUnitPrice(
        ...args: Parameters<OrderItemPriceCalculationStrategy['calculateUnitPrice']>
    ): Promise<PriceCalculationResult> {
        const result = await this.inner.calculateUnitPrice(...args);
        orderItemMetadata.push(result.metadata);
        return result;
    }
}

/** Adds a field to the `BuyerPrice` type that reads the metadata of the strategy result. */
@Resolver('BuyerPrice')
export class BuyerPriceRuleResolver {
    @ResolveField()
    appliedRule(@Parent() buyerPrice: BuyerPriceResult): string | null {
        const rule = buyerPrice.metadata?.rule;
        return typeof rule === 'string' ? rule : null;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    shopApiExtensions: {
        schema: gql`
            extend type BuyerPrice {
                appliedRule: String
            }
        `,
        resolvers: [BuyerPriceRuleResolver],
    },
    configuration: config => {
        config.catalogOptions.productVariantBuyerPriceStrategy = composeStrategy(
            TestBuyerPriceLayer,
            config.catalogOptions.productVariantBuyerPriceStrategy,
        );
        config.orderOptions.orderItemPriceCalculationStrategy = composeStrategy(
            MetadataRecordingLayer,
            config.orderOptions.orderItemPriceCalculationStrategy,
        );
        return config;
    },
})
export class TestBuyerPricePlugin {}
