import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity, Index, ManyToOne } from 'typeorm';

import { Order } from '../order/order.entity';

import { HistoryEntry } from './history-entry.entity';

/**
 * @description
 * Represents an event in the history of a particular {@link Order}.
 *
 * @docsCategory entities
 */
@ChildEntity()
export class OrderHistoryEntry extends HistoryEntry {
    constructor(input: DeepPartial<OrderHistoryEntry>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => Order, { onDelete: 'CASCADE' })
    order: Order;
}
