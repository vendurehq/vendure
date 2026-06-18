import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { ChildEntity, Index, ManyToOne } from 'typeorm';

import { EntityId } from '../entity-id.decorator';
import { Fulfillment } from '../fulfillment/fulfillment.entity';

import { OrderLineReference } from './order-line-reference.entity';

/**
 * @description
 * This entity represents a line from an {@link Order} which has been fulfilled by a {@link Fulfillment}.
 *
 * @docsCategory entities
 * @docsPage OrderLineReference
 */
@ChildEntity()
export class FulfillmentLine extends OrderLineReference {
    constructor(input?: DeepPartial<FulfillmentLine>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => Fulfillment, fulfillment => fulfillment.lines)
    fulfillment: Fulfillment;

    @EntityId()
    fulfillmentId: ID;
}
