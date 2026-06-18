import { ConfigArg } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { ShippingMethod, Order } from '../../entity';

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
}

export type CalculateShippingFnResult =
    | ShippingCalculationResult
    | Promise<ShippingCalculationResult | undefined>
    | undefined;

/**
 * @description
 * A function which implements the specific shipping calculation logic. It takes an {@link Order} and
 * an arguments object and should return the shipping price as an integer in cents.
 *
 * Should return a {@link ShippingCalculationResult} object.
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
