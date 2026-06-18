import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Product } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a {@link ProductOptionGroup} is assigned or removed from a {@link Product}.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class ProductOptionGroupChangeEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public product: Product,
        public optionGroupId: ID,
        public type: 'assigned' | 'removed',
    ) {
        super();
    }
}
