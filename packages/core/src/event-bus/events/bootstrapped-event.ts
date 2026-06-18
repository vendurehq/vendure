import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when vendure finished bootstrapping.
 * For the server and worker process, this happens after the welcome message is logged.
 *
 * Use this event to preload data into the cache or perform other startup logic that would otherwise * block
 * the bootstrapping process and slow down server start time. To avoid missing this event, subscribers should
 * be registered during module initialization \(for example in `OnApplicationBootstrap`\), not after `bootstrap\(\)` resolves.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 3.5.6
 */
export class BootstrappedEvent extends VendureEvent {
    constructor() {
        super();
    }
}
