import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when vendure finished initializing its services inside the {@link InitializerService}
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.7.0
 */
export class InitializerEvent extends VendureEvent {
    constructor() {
        super();
    }
}
