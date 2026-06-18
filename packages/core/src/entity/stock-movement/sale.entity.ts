import { StockMovementType } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity, Index, ManyToOne } from 'typeorm';

import { OrderLine } from '../order-line/order-line.entity';

import { StockMovement } from './stock-movement.entity';

/**
 * @description
 * A Sale is created when OrderItems are fulfilled.
 *
 * @docsCategory entities
 * @docsPage StockMovement
 */
@ChildEntity()
export class Sale extends StockMovement {
    readonly type = StockMovementType.SALE;

    constructor(input: DeepPartial<Sale>) {
        super(input);
    }

    // @Index() omitted as it would conflict with the orderLineId index from the Allocation entity
    @ManyToOne(type => OrderLine, line => line.sales)
    orderLine: OrderLine;
}
