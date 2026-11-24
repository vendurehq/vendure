import { Type } from '@vendure/common/lib/shared-types';
import { Column, getMetadataArgsStorage } from 'typeorm';

import { MoneyStrategy } from '../config/entity/money-strategy';

import { getMoneyColumnsFor } from './money.decorator';
import { OrderLine } from './order-line/order-line.entity';

export function setMoneyStrategy(
    moneyStrategy: MoneyStrategy,
    entities: Array<Type<any>>,
    quoteLinePrices = false,
) {
    const quoteColumns = {
        quotedLinePrice: moneyStrategy.moneyColumnOptions,
        quotedQuantity: { type: 'int' as const },
        quotedRefundTotal: moneyStrategy.moneyColumnOptions,
    };
    // TypeORM shares decorator metadata across bootstraps in the same process.
    const { columns } = getMetadataArgsStorage();
    for (let i = columns.length - 1; i >= 0; i--) {
        const { target, propertyName } = columns[i];
        if (target === OrderLine && Object.prototype.hasOwnProperty.call(quoteColumns, propertyName)) {
            columns.splice(i, 1);
        }
    }
    if (quoteLinePrices) {
        for (const [name, options] of Object.entries(quoteColumns)) {
            Column({ ...options, nullable: true })(OrderLine.prototype, name);
        }
    }

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
