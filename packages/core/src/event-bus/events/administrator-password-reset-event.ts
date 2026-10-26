import { RequestContext } from '../../api/common/request-context';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { User } from '../../entity/user/user.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when an Administrator requests a password reset email.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 3.8.0
 */
export class AdministratorPasswordResetEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public administrator: Administrator,
        public user: User,
    ) {
        super();
    }
}
