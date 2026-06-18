import { StockMovementType } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { StockMovement } from '../../entity/stock-movement/stock-movement.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a {@link StockMovement} entity is created, which occurs when the saleable
 * stock level of a ProductVariant is altered due to things like sales, manual adjustments, and cancellations.
 *
 * @since 1.1.0
 * @docsCategory events
 * @docsPage Event Types
 */
export class StockMovementEvent extends VendureEvent {
    public readonly type: StockMovementType;

    constructor(public ctx: RequestContext, public stockMovements: StockMovement[]) {
        super();
        this.type = stockMovements[0]?.type;
    }
}
