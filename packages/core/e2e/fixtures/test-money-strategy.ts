import { DefaultMoneyStrategy } from '@vendure/core';

export class TestMoneyStrategy extends DefaultMoneyStrategy {
    round(value: number, quantity = 1): number {
        return Math.round(value * quantity);
    }
}
