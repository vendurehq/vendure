import { CreateStockLocationInput, UpdateStockLocationInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { StockLocation } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type StockLocationInputTypes = CreateStockLocationInput | UpdateStockLocationInput | ID;

/**
 * @description
 * This event is fired whenever a {@link StockLocation} is added, updated
 * or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class StockLocationEvent extends VendureEntityEvent<StockLocation, StockLocationInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: StockLocation,
        type: 'created' | 'updated' | 'deleted',
        input?: StockLocationInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
