import { RequestContext } from '../../api/common/request-context';
import { User } from '../../entity/user/user.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when a registered user successfully changes the identifier (ie email address)
 * associated with their account.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class IdentifierChangeEvent extends VendureEvent {
    constructor(public ctx: RequestContext, public user: User, public oldIdentifier: string) {
        super();
    }
}
