import { StockMovementType } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity, ManyToOne } from 'typeorm';

import { OrderLine } from '../order-line/order-line.entity';

import { StockMovement } from './stock-movement.entity';

/**
 * @description
 * A Release is created when OrderItems which have been allocated (but not yet fulfilled)
 * are cancelled.
 *
 * @docsCategory entities
 * @docsPage StockMovement
 */
@ChildEntity()
export class Release extends StockMovement {
    readonly type = StockMovementType.RELEASE;

    constructor(input: DeepPartial<Release>) {
        super(input);
    }

    // @Index() omitted as it would conflict with the orderLineId index from the Allocation entity
    @ManyToOne(type => OrderLine)
    orderLine: OrderLine;
}
