import { ColumnOptions } from 'typeorm';


import { MoneyStrategy } from './money-strategy';

/**
 * @description
 * A {@link MoneyStrategy} that stores monetary values as an `int` type in the database.
 * Multiplies the unit amount by the quantity and rounds the resulting line amount.
 *
 * @docsCategory money
 * @since 2.0.0
 */
export class DefaultMoneyStrategy implements MoneyStrategy {
    readonly moneyColumnOptions: ColumnOptions = {
        type: 'int',
    };
    readonly precision: number = 2;

    round(value: number, quantity = 1): number {
        return Math.round(value * quantity);
    }
}
