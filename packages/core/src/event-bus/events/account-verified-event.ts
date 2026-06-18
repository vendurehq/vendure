import { RequestContext } from '../../api/common/request-context';
import { Customer } from '../../entity/customer/customer.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when a users email address successfully gets verified after
 * the `verifyCustomerAccount` mutation was executed.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class AccountVerifiedEvent extends VendureEvent {
    constructor(public ctx: RequestContext, public customer: Customer) {
        super();
    }
}
