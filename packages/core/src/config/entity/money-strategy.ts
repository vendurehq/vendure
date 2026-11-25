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
 * effective limit of ~21.4 million major currency units at the default precision of 2. For certain use cases
 * (e.g. business sales with very high amounts, or currencies with very large
 * denominations), this may cause issues. In this case, you can use the
 * {@link BigIntMoneyStrategy} which will use the `bigint` type to store monetary values,
 * giving an effective upper limit of over 9 quadrillion.
 *
 * ## Precision
 *
 * Both strategies store money as integers. At precision 4, a unit price of 1.235 is `12350`,
 * and 20 units at this price give a line price of `247000`, which is 24.70. Product CSV files
 * express prices in major currency units.
 *
 * Changing precision on an existing installation requires rescaling stored monetary amounts.
 * Payment integrations must convert amounts to the units their provider accepts.
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
     * Vendure uses this scale to convert between integer amounts and major currency units.
     * Changing it does not rescale existing data.
     *
     * @default 2
     * @since 2.2.0
     */
    readonly precision?: number;

    /**
     * @description
     * Defines the logic used to round monetary values. For instance, the default behavior
     * in the {@link DefaultMoneyStrategy} is to multiply the unit value by the
     * quantity and then round the result:
     *
     * ```ts
     * return Math.round(value * quantity);
     * ```
     *
     * However, it may be desirable to instead round the unit amount _before_
     * multiplying (this was the default prior to v3.1). In this case you can
     * define a custom strategy with logic like this:
     *
     * ```ts
     * return Math.round(value) * quantity;
     * ```
     */
    round(value: number, quantity?: number): number;
}

/**
 * @description
 * The number of decimal places that a {@link MoneyStrategy} uses when it does not set `precision`.
 *
 * @docsCategory money
 * @since 3.8.3
 */
export const DEFAULT_MONEY_PRECISION = 2;

/**
 * @description
 * Returns the number of decimal places of the given {@link MoneyStrategy}, which is
 * {@link DEFAULT_MONEY_PRECISION} unless the strategy sets `precision`.
 *
 * @example
 * ```ts
 * const precision = getMoneyPrecision(configService.entityOptions.moneyStrategy);
 * const majorUnits = amount / 10 ** precision;
 * ```
 *
 * @docsCategory money
 * @since 3.8.3
 */
export function getMoneyPrecision(moneyStrategy: Pick<MoneyStrategy, 'precision'>): number {
    return moneyStrategy.precision ?? DEFAULT_MONEY_PRECISION;
}
