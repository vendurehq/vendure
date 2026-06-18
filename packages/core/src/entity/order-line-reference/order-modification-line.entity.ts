import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { ChildEntity, Index, ManyToOne } from 'typeorm';

import { EntityId } from '../entity-id.decorator';
import { OrderModification } from '../order-modification/order-modification.entity';

import { OrderLineReference } from './order-line-reference.entity';

/**
 * @description
 * This entity represents a line from an {@link Order} which has been modified by an {@link OrderModification}.
 *
 * @docsCategory entities
 * @docsPage OrderLineReference
 */
@ChildEntity()
export class OrderModificationLine extends OrderLineReference {
    constructor(input?: DeepPartial<OrderModificationLine>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => OrderModification, modification => modification.lines)
    modification: OrderModification;

    @EntityId()
    modificationId: ID;
}
