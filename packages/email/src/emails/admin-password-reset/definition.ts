import { AdministratorPasswordResetEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleAdministrator } from '../account-helpers';

import { AdminPasswordResetTemplate } from './template';

/**
 * @description
 * Sent when an administrator requests a password reset. Needs the `adminPasswordResetUrl` global
 * template variable.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const adminPasswordResetEmail = defineEmail({
    type: 'admin-password-reset',
    label: 'Administrator password reset',
    event: AdministratorPasswordResetEvent,
    data: ({ event }) => ({
        passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken ?? '',
    }),
    recipient: ({ event }) => event.administrator.emailAddress,
    template: markPackageDefault(AdminPasswordResetTemplate),
    sample: async input => {
        const found = await findSampleAdministrator(input);
        if (!found) {
            return undefined;
        }
        const nativeAuth = found.user.getNativeAuthenticationMethod();
        nativeAuth.passwordResetToken = nativeAuth.passwordResetToken ?? 'sample-password-reset-token';
        return new AdministratorPasswordResetEvent(input.ctx, found.administrator, found.user);
    },
});
