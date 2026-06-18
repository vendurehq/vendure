import { ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne, TableInheritance } from 'typeorm';

import { VendureEntity } from '../base/base.entity';
import { EntityId } from '../entity-id.decorator';
import { OrderLine } from '../order-line/order-line.entity';

/**
 * @description
 * This is an abstract base class for entities which reference an {@link OrderLine}.
 *
 * @docsCategory entities
 * @docsPage OrderLineReference
 */
@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'discriminator' } })
export abstract class OrderLineReference extends VendureEntity {
    @Column()
    quantity: number;

    @Index()
    @ManyToOne(type => OrderLine, line => line.linesReferences, { onDelete: 'CASCADE' })
    orderLine: OrderLine;

    @EntityId()
    orderLineId: ID;
}
