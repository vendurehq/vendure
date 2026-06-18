import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity, Index, ManyToOne } from 'typeorm';

import { Customer } from '../customer/customer.entity';

import { HistoryEntry } from './history-entry.entity';

/**
 * @description
 * Represents an event in the history of a particular {@link Customer}.
 *
 * @docsCategory entities
 */
@ChildEntity()
export class CustomerHistoryEntry extends HistoryEntry {
    constructor(input: DeepPartial<CustomerHistoryEntry>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => Customer, { onDelete: 'CASCADE' })
    customer: Customer;
}
