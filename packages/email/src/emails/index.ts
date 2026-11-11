import { EmailDefinition } from '../define-email';

import { adminPasswordResetEmail } from './admin-password-reset/definition';
import { emailAddressChangeEmail } from './email-address-change/definition';
import { emailVerificationEmail } from './email-verification/definition';
import { orderCancelledEmail } from './order-cancelled/definition';
import { orderConfirmationEmail } from './order-confirmation/definition';
import { orderDeliveredEmail } from './order-delivered/definition';
import { orderRefundedEmail } from './order-refunded/definition';
import { orderShippedEmail } from './order-shipped/definition';
import { passwordResetEmail } from './password-reset/definition';
import { paymentFailedEmail } from './payment-failed/definition';

export * from './admin-password-reset/definition';
export * from './admin-password-reset/template';
export * from './email-address-change/definition';
export * from './email-address-change/template';
export * from './email-verification/definition';
export * from './email-verification/template';
export * from './order-cancelled/definition';
export * from './order-cancelled/template';
export * from './order-confirmation/definition';
export * from './order-confirmation/template';
export * from './order-delivered/definition';
export * from './order-delivered/template';
export * from './order-refunded/definition';
export * from './order-refunded/template';
export * from './order-shipped/definition';
export * from './order-shipped/template';
export * from './password-reset/definition';
export * from './password-reset/template';
export * from './payment-failed/definition';
export * from './payment-failed/template';
export * from './order-helpers';

/**
 * @description
 * The emails that ship with `@vendure/email`. Replace an entry to customise it:
 *
 * ```ts
 * emails: defaultEmails.map(e => (e.type === 'order-confirmation' ? myOrderConfirmation : e)),
 * ```
 *
 * or list the emails explicitly, which is what `@vendure/create` scaffolds.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const defaultEmails: Array<EmailDefinition<any, any>> = [
    orderConfirmationEmail,
    orderShippedEmail,
    orderDeliveredEmail,
    orderCancelledEmail,
    orderRefundedEmail,
    paymentFailedEmail,
    emailVerificationEmail,
    passwordResetEmail,
    adminPasswordResetEmail,
    emailAddressChangeEmail,
];
