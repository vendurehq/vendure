import { ColumnOptions } from 'typeorm';

import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The MoneyStrategy defines how monetary values are stored and manipulated. The MoneyStrategy
 * is defined in {@link EntityOptions}:
 *
 * @example
 * ```ts
 * const config: VendureConfig = {
 *   entityOptions: {
 *     moneyStrategy: new MyCustomMoneyStrategy(),
 *   }
 * };
 * ```
 *
 * ## Range
 *
 * The {@link DefaultMoneyStrategy} uses an `int` field in the database, which puts an
 * effective limit of ~21.4 million on any stored value. For certain use cases
 * (e.g. business sales with very high amounts, or currencies with very large
 * denominations), this may cause issues. In this case, you can use the
 * {@link BigIntMoneyStrategy} which will use the `bigint` type to store monetary values,
 * giving an effective upper limit of over 9 quadrillion.
 *
 * ## Precision
 *
 * Both the `DefaultMoneyStrategy` and `BigIntMoneyStrategy` store monetary values as integers, representing
 * the price in the minor units of the currency (i.e. _cents_ in USD or _pennies_ in GBP).
 *
 * Since v2.2.0, you can configure the precision of the stored values via the `precision` property of the
 * strategy. Changing the precision has **no effect** on the stored value. It is merely a hint to the
 * UI as to how many decimal places to display.
 *
 * @example
 * ```ts
 * import { DefaultMoneyStrategy, VendureConfig } from '\@vendure/core';
 *
 * export class ThreeDecimalPlacesMoneyStrategy extends DefaultMoneyStrategy {
 *   readonly precision = 3;
 * }
 *
 * export const config: VendureConfig = {
 *   // ...
 *   entityOptions: {
 *     moneyStrategy: new ThreeDecimalPlacesMoneyStrategy(),
 *   }
 * };
 * ```
 *
 * :::info
 *
 * This is configured via the `entityOptions.moneyStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory money
 * @since 2.0.0
 */
export interface MoneyStrategy extends InjectableStrategy {
    /**
     * @description
     * Defines the TypeORM column used to store monetary values.
     */
    readonly moneyColumnOptions: ColumnOptions;
    /**
     * @description
     * Defines the precision (i.e. number of decimal places) represented by the monetary values.
     * For example, consider a product variant with a price value of `12345`.
     *
     * - If the precision is `2`, then the price is `123.45`.
     * - If the precision is `3`, then the price is `12.345`.
     *
     * Changing the precision has **no effect** on the stored value. It is merely a hint to the
     * UI as to how many decimal places to display.
     *
     * @default 2
     * @since 2.2.0
     */
    readonly precision?: number;

    /**
     * @description
     * Defines the logic used to round monetary values. For instance, the default behavior
     * in the {@link DefaultMoneyStrategy} is to round the value, then multiply.
     *
     * ```ts
     * return Math.round(value * quantity);
     * ```
     *
     * However, it may be desirable to instead round only _after_ the unit amount has been
     * multiplied. In this case you can define a custom strategy with logic like this:
     *
     * ```ts
     * return Math.round(value * quantity);
     * ```
     */
    round(value: number, quantity?: number): number;
}
