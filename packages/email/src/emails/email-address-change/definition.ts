import { IdentifierChangeRequestEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleCustomerUser } from '../account-helpers';

import { EmailAddressChangeTemplate } from './template';

/**
 * @description
 * Sent to the new address when a customer requests to change their email address.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const emailAddressChangeEmail = defineEmail({
    type: 'email-address-change',
    label: 'Email address change',
    event: IdentifierChangeRequestEvent,
    data: ({ event }) => ({
        identifierChangeToken: event.user.getNativeAuthenticationMethod().identifierChangeToken ?? '',
    }),
    recipient: ({ event }) => event.user.getNativeAuthenticationMethod().pendingIdentifier ?? '',
    template: markPackageDefault(EmailAddressChangeTemplate),
    sample: async input => {
        const user = await findSampleCustomerUser(input);
        if (!user) {
            return undefined;
        }
        const nativeAuth = user.getNativeAuthenticationMethod();
        nativeAuth.identifierChangeToken = nativeAuth.identifierChangeToken ?? 'sample-identifier-change-token';
        nativeAuth.pendingIdentifier =
            input.args.newEmail ?? nativeAuth.pendingIdentifier ?? `new.${nativeAuth.identifier}`;
        return new IdentifierChangeRequestEvent(input.ctx, user);
    },
});
