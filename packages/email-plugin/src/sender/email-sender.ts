import { InjectableStrategy } from '@vendure/core';

import { EmailDetails, EmailTransportOptions } from '../types';

/**
 * @description
 * An EmailSender is responsible for sending the email, e.g. via an SMTP connection
 * or using some other mail-sending API. By default, the EmailPlugin uses the
 * {@link NodemailerEmailSender}, but it is also possible to supply a custom implementation:
 *
 * @example
 * ```ts
 * const sgMail = require('\@sendgrid/mail');
 *
 * sgMail.setApiKey(process.env.SENDGRID_API_KEY);
 *
 * class SendgridEmailSender implements EmailSender {
 *   async send(email: EmailDetails) {
 *     await sgMail.send({
 *       to: email.recipient,
 *       from: email.from,
 *       subject: email.subject,
 *       html: email.body,
 *     });
 *   }
 * }
 *
 * const config: VendureConfig = {
 *   logger: new DefaultLogger({ level: LogLevel.Debug })
 *   // ...
 *   plugins: [
 *     EmailPlugin.init({
 *        // ... template, handler config omitted
 *       transport: { type: 'none' },
 *        emailSender: new SendgridEmailSender(),
 *     }),
 *   ],
 * };
 * ```
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage EmailSender
 * @docsWeight 0
 */
export interface EmailSender extends InjectableStrategy {
    send: (email: EmailDetails, options: EmailTransportOptions) => void | Promise<void>;
}
