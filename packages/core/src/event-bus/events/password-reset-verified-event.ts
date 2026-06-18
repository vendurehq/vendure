import { RequestContext } from '../../api/common/request-context';
import { User } from '../../entity/user/user.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when a password reset is executed with a verified token.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class PasswordResetVerifiedEvent extends VendureEvent {
    constructor(public ctx: RequestContext, public user: User) {
        super();
    }
}
