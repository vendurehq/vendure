import { getConfig } from '../config/config-helpers';
import { MoneyStrategy } from '../config/entity/money-strategy';

let moneyStrategy: MoneyStrategy;

/**
 * @description
 * Rounds a monetary value according to the configured {@link MoneyStrategy}.
 *
 * @docsCategory money
 * @since 2.0.0
 */
export function roundMoney(value: number, quantity = 1): number {
    if (!moneyStrategy) {
        moneyStrategy = getConfig().entityOptions.moneyStrategy;
    }
    return moneyStrategy.round(value, quantity);
}
