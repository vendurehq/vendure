import { PasswordResetEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleCustomerUser } from '../account-helpers';

import { PasswordResetTemplate } from './template';

/**
 * @description
 * Sent when a customer requests a password reset.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const passwordResetEmail = defineEmail({
    type: 'password-reset',
    label: 'Password reset',
    event: PasswordResetEvent,
    data: ({ event }) => ({
        passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken ?? '',
    }),
    recipient: ({ event }) => event.user.identifier,
    template: markPackageDefault(PasswordResetTemplate),
    sample: async input => {
        const user = await findSampleCustomerUser(input);
        if (!user) {
            return undefined;
        }
        const nativeAuth = user.getNativeAuthenticationMethod();
        nativeAuth.passwordResetToken = nativeAuth.passwordResetToken ?? 'sample-password-reset-token';
        return new PasswordResetEvent(input.ctx, user);
    },
});
