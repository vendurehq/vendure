import { RequestContext } from '../../api/common/request-context';
import { Fulfillment } from '../../entity/fulfillment/fulfillment.entity';
import { FulfillmentState } from '../../service/helpers/fulfillment-state-machine/fulfillment-state';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever an {@link Fulfillment} transitions from one {@link FulfillmentState} to another.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class FulfillmentStateTransitionEvent extends VendureEvent {
    constructor(
        public fromState: FulfillmentState,
        public toState: FulfillmentState,
        public ctx: RequestContext,
        public fulfillment: Fulfillment,
    ) {
        super();
    }
}
