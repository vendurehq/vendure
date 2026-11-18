import { ConfigArg } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { Order, ShippingMethod } from '../../entity';

export interface ShippingCalculatorConfig<T extends ConfigArgs> extends ConfigurableOperationDefOptions<T> {
    calculate: CalculateShippingFn<T>;
}

/**
 * @description
 * The ShippingCalculator is used by a {@link ShippingMethod} to calculate the price of shipping on a given {@link Order}.
 *
 * @example
 * ```ts
 * const flatRateCalculator = new ShippingCalculator({
 *   code: 'flat-rate-calculator',
 *   description: [{ languageCode: LanguageCode.en, value: 'Default Flat-Rate Shipping Calculator' }],
 *   args: {
 *     rate: {
 *       type: 'int',
 *       ui: { component: 'currency-form-input' },
 *     },
 *     taxRate: {
         type: 'int',
         ui: { component: 'number-form-input', suffix: '%' },
       },
 *   },
 *   calculate: (ctx, order, args) => {
 *     return {
 *       price: args.rate,
 *       taxRate: args.taxRate,
 *       priceIncludesTax: ctx.channel.pricesIncludeTax,
 *     };
 *   },
 * });
 * ```
 *
 * ## Several options per ShippingMethod
 *
 * A calculator may instead return an array of results, one for each ShippingOption it offers. This suits
 * carrier APIs which return several services with a price for each. Give every result a `code` which is
 * unique within the array, so the chosen option can be identified when the Order is recalculated, and a
 * `name` to show to the customer.
 *
 * The customer chooses an option with `setOrderShippingMethod(shippingMethods: [{ shippingMethodId, shippingOptionCode }])`.
 * Without a code, the cheapest option is used. The chosen code is stored as `ShippingLine.shippingOptionCode`.
 * Each time the Order is recalculated the calculator runs again and the result with the stored code is used.
 * If that code is no longer returned, the ShippingLine falls back to the cheapest option of any eligible
 * ShippingMethod, as it does when a ShippingMethod becomes ineligible. The transition to `ArrangingPayment`
 * is refused if the chosen option is no longer offered.
 *
 * @example
 * ```ts
 * const carrierCalculator = new ShippingCalculator({
 *   code: 'carrier-rates',
 *   description: [{ languageCode: LanguageCode.en, value: 'Live carrier rates' }],
 *   args: {},
 *   calculate: async (ctx, order) => {
 *     const rates = await carrierApi.getRates(order);
 *     return rates.map(rate => ({
 *       code: rate.serviceCode,
 *       name: rate.serviceName,
 *       price: rate.amount,
 *       priceIncludesTax: false,
 *       taxRate: 20,
 *     }));
 *   },
 * });
 * ```
 *
 * @docsCategory shipping
 * @docsPage ShippingCalculator
 */
export class ShippingCalculator<T extends ConfigArgs = ConfigArgs> extends ConfigurableOperationDef<T> {
    private readonly calculateFn: CalculateShippingFn<T>;

    constructor(config: ShippingCalculatorConfig<T>) {
        super(config);
        this.calculateFn = config.calculate;
    }

    /**
     * @description
     * Calculates the price of shipping for the given Order.
     *
     * @internal
     */
    calculate(
        ctx: RequestContext,
        order: Order,
        args: ConfigArg[],
        method: ShippingMethod,
    ): CalculateShippingFnResult {
        return this.calculateFn(ctx, order, this.argsArrayToHash(args), method);
    }
}

/**
 * @description
 * The return value of the {@link CalculateShippingFn}.
 *
 * @docsCategory shipping
 * @docsPage ShippingCalculator
 */
export interface ShippingCalculationResult {
    /**
     * @description
     * The shipping price without any taxes.
     */
    price: number;
    /**
     * @description
     * Whether or not the given price already includes taxes.
     */
    priceIncludesTax: boolean;
    /**
     * @description
     * The tax rate applied to the shipping price.
     */
    taxRate: number;
    /**
     * @description
     * Arbitrary metadata may be returned from the calculation function. This can be used
     * e.g. to return data on estimated delivery times or any other data which may be
     * needed in the storefront application when listing eligible shipping methods.
     */
    metadata?: Record<string, any>;
    /**
     * @description
     * Identifies this ShippingOption within its ShippingMethod, e.g. a carrier service code such as
     * `'ups_ground'`. Required, and unique within the array, when the calculator returns more than one
     * result: otherwise an error is logged and the ShippingMethod is unavailable for the Order. Stored on
     * the ShippingLine as `shippingOptionCode` when the option is chosen.
     *
     * @since 4.0.0
     */
    code?: string;
    /**
     * @description
     * The name of this ShippingOption to show to the customer, e.g. `'UPS Ground'`. Stored on the
     * ShippingLine as `shippingOptionName` when the option is chosen.
     *
     * @since 4.0.0
     */
    name?: string;
}

type ShippingCalculationResults = ShippingCalculationResult | ShippingCalculationResult[] | undefined;

export type CalculateShippingFnResult = ShippingCalculationResults | Promise<ShippingCalculationResults>;

/**
 * @description
 * A function which implements the specific shipping calculation logic. It takes an {@link Order} and
 * an arguments object and should return the shipping price as an integer in cents.
 *
 * Should return a {@link ShippingCalculationResult} object, or an array of them if the ShippingMethod
 * offers several options. Returning `undefined` or an empty array means the ShippingMethod is not
 * available for the Order.
 *
 * @docsCategory shipping
 * @docsPage ShippingCalculator
 */
export type CalculateShippingFn<T extends ConfigArgs> = (
    ctx: RequestContext,
    order: Order,
    args: ConfigArgValues<T>,
    method: ShippingMethod,
) => CalculateShippingFnResult;
