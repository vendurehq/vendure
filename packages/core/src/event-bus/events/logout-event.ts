import { RequestContext } from '../../api/common/request-context';
import { User } from '../../entity/user/user.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when a user logs out via the shop or admin API `logout` mutation.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class LogoutEvent extends VendureEvent {
    constructor(public ctx: RequestContext) {
        super();
    }
}
