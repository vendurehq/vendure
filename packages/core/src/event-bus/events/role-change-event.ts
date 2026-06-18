import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Administrator, Role } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever one {@link Role} is assigned or removed from a user.
 * The property `roleIds` only contains the removed or assigned role ids.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class RoleChangeEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public admin: Administrator,
        public roleIds: ID[],
        public type: 'assigned' | 'removed',
    ) {
        super();
    }
}
