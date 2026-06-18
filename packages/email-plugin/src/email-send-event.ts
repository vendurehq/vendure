import { RequestContext, VendureEvent } from '@vendure/core';

import { EmailDetails, EmailMetadata } from './types';

/**
 * @description
 * This event is fired when an email sending attempt has been made. If the sending was successful,
 * the `success` property will be `true`, and if not, the `error` property will contain the error
 * which occurred.
 *
 * @docsCategory core plugins/EmailPlugin
 * @since 2.2.0
 */
export class EmailSendEvent extends VendureEvent {
    constructor(
        public readonly ctx: RequestContext,
        public readonly details: EmailDetails,
        public readonly success: boolean,
        public readonly error?: Error,
        public readonly metadata?: EmailMetadata,
    ) {
        super();
    }
}
