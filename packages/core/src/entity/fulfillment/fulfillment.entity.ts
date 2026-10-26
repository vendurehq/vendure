import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, ManyToMany, OneToMany } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { FulfillmentState } from '../../service/helpers/fulfillment-state-machine/fulfillment-state';
import { VendureEntity } from '../base/base.entity';
import { CustomFulfillmentFields } from '../custom-entity-fields';
import { Order } from '../order/order.entity';
import { FulfillmentLine } from '../order-line-reference/fulfillment-line.entity';

/**
 * @description
 * This entity represents a fulfillment of an Order or part of it, i.e. which {@link OrderLine}s have been
 * delivered to the Customer after successful payment.
 *
 * @docsCategory entities
 */
@Entity()
export class Fulfillment extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<Fulfillment>) {
        super(input);
    }

    @Column('varchar') state: FulfillmentState;

    @Column({ default: '' })
    trackingCode: string;

    @Column()
    method: string;

    @Column()
    handlerCode: string;

    @OneToMany(type => FulfillmentLine, fulfillmentLine => fulfillmentLine.fulfillment)
    lines: FulfillmentLine[];

    // Declared explicitly: TypeORM 1.1.1+ defaults an undeclared inverse junction FK rule to CASCADE (#5594).
    @ManyToMany(type => Order, order => order.fulfillments, { onDelete: 'NO ACTION', onUpdate: 'NO ACTION' })
    orders: Order[];

    @Column(type => CustomFulfillmentFields)
    customFields: CustomFulfillmentFields;
}
