import { ColumnOptions } from 'typeorm';

import { Logger } from '../logger/vendure-logger';

import { MoneyStrategy } from './money-strategy';

/**
 * @description
 * A {@link MoneyStrategy} that stores monetary values as a `bigint` type in the database, which
 * allows values up to ~9 quadrillion to be stored (limited by JavaScript's `MAX_SAFE_INTEGER` limit).
 *
 * This strategy also slightly differs in the way rounding is performed, with rounding being done _after_
 * multiplying the unit price, rather than before (as is the case with the {@link DefaultMoneyStrategy}.
 *
 * @docsCategory money
 * @since 2.0.0
 */
export class BigIntMoneyStrategy implements MoneyStrategy {
    readonly moneyColumnOptions: ColumnOptions = {
        type: 'bigint',
        transformer: {
            to: (entityValue: number) => {
                return entityValue;
            },
            from: (databaseValue: string): number => {
                if (databaseValue == null) {
                    return databaseValue;
                }
                const intVal = Number.parseInt(databaseValue, 10);
                if (!Number.isSafeInteger(intVal)) {
                    Logger.warn(`Monetary value ${databaseValue} is not a safe integer!`);
                }
                if (Number.isNaN(intVal)) {
                    Logger.warn(`Monetary value ${databaseValue} is not a number!`);
                }
                return intVal;
            },
        },
    };
    precision = 2;

    round(value: number, quantity = 1): number {
        return Math.round(value * quantity);
    }
}
