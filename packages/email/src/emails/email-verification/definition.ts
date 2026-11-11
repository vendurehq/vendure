import { AccountRegistrationEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleCustomerUser } from '../account-helpers';

import { EmailVerificationTemplate } from './template';

/**
 * @description
 * Sent when a customer registers with an email address and password.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const emailVerificationEmail = defineEmail({
    type: 'email-verification',
    label: 'Email verification',
    event: AccountRegistrationEvent,
    filter: event => !!event.user.getNativeAuthenticationMethod(false)?.identifier,
    data: ({ event }) => ({
        verificationToken: event.user.getNativeAuthenticationMethod().verificationToken ?? '',
    }),
    recipient: ({ event }) => event.user.identifier,
    template: markPackageDefault(EmailVerificationTemplate),
    sample: async input => {
        const user = await findSampleCustomerUser(input);
        if (!user) {
            return undefined;
        }
        const nativeAuth = user.getNativeAuthenticationMethod();
        nativeAuth.verificationToken = nativeAuth.verificationToken ?? 'sample-verification-token';
        return new AccountRegistrationEvent(input.ctx, user);
    },
});
