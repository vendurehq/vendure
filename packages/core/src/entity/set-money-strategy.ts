import { Type } from '@vendure/common/lib/shared-types';
import { Column } from 'typeorm';

import { MoneyStrategy } from '../config/entity/money-strategy';

import { getMoneyColumnsFor } from './money.decorator';

export function setMoneyStrategy(moneyStrategy: MoneyStrategy, entities: Array<Type<any>>) {
    for (const EntityCtor of entities) {
        const columnConfig = getMoneyColumnsFor(EntityCtor);
        for (const { name, options, entity } of columnConfig) {
            Column({
                ...moneyStrategy.moneyColumnOptions,
                nullable: options?.nullable ?? false,
                default: options?.default,
            })(entity, name);
        }
    }
}
