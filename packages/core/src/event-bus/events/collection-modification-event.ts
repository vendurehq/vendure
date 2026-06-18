import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Collection } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a Collection is modified in some way. The `productVariantIds`
 * argument is an array of ids of all ProductVariants which:
 *
 * 1. were part of this collection prior to modification and are no longer
 * 2. are now part of this collection after modification but were not before
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class CollectionModificationEvent extends VendureEvent {
    constructor(public ctx: RequestContext, public collection: Collection, public productVariantIds: ID[]) {
        super();
    }
}
