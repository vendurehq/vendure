import { RequestContext } from '../../api/common/request-context';
import { TaxRate } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a TaxRate is changed
 *
 * @docsCategory events
 * @docsPage Event Types
 * @deprecated Use TaxRateEvent instead
 */
export class TaxRateModificationEvent extends VendureEvent {
    constructor(public ctx: RequestContext, public taxRate: TaxRate) {
        super();
    }
}
