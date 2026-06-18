import { RequestContext } from '../../api/common/request-context';
import { User } from '../../entity/user/user.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when an attempt is made to log in via the shop or admin API `login` mutation.
 * The `strategy` represents the name of the AuthenticationStrategy used in the login attempt.
 * If the "native" strategy is used, the additional `identifier` property will be available.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class AttemptedLoginEvent extends VendureEvent {
    constructor(public ctx: RequestContext, public strategy: string, public identifier?: string) {
        super();
    }
}
