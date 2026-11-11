import type { EmailDefinition } from './define-email';
import type { EmailSender } from './sender/email-sender';
import type { EmailTemplateLoader } from './template/template-loader';
import { Injector, RequestContext, SerializedRequestContext, VendureEvent } from '@vendure/core';
import { Attachment } from 'nodemailer/lib/mailer';
import SESTransport from 'nodemailer/lib/ses-transport';
import SMTPPool from 'nodemailer/lib/smtp-pool';
import SMTPTransport from 'nodemailer/lib/smtp-transport';


export type EventWithContext = VendureEvent & { ctx: RequestContext };

/**
 * @description
 * The variables available to every email template, in addition to the email's own data.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export type GlobalTemplateVars = { [key: string]: any };

export type GlobalTemplateVarsFn = (
    ctx: RequestContext,
    injector: Injector,
) => GlobalTemplateVars | Promise<GlobalTemplateVars>;

/**
 * @description
 * Options for the {@link EmailPlugin} of `@vendure/email`.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export interface EmailPluginOptions {
    /**
     * @description
     * The emails to send. Use `defaultEmails` for the built-in set, and replace or add entries
     * made with {@link defineEmail}.
     */
    emails: Array<EmailDefinition<any, any>>;
    /**
     * @description
     * The "from" address used by every email that does not set its own `from`.
     * May contain `{{ path }}` placeholders, filled from the template variables.
     */
    defaultFrom: string;
    /**
     * @description
     * Variables available to every template, e.g. `branding` and storefront URLs.
     */
    globalTemplateVars?: GlobalTemplateVars | GlobalTemplateVarsFn;
    /**
     * @description
     * Loaders tried in order before the template of the email definition. A loader returns
     * `undefined` to pass to the next one. This is where stored overrides (e.g. from a visual
     * editor) plug in.
     */
    templateLoader?: EmailTemplateLoader | EmailTemplateLoader[];
    transport:
        | EmailTransportOptions
        | ((
              injector?: Injector,
              ctx?: RequestContext,
          ) => EmailTransportOptions | Promise<EmailTransportOptions>);
    emailSender?: EmailSender;
    /**
     * @description
     * Adds a note to the order history for every email sent about an order.
     *
     * @default true
     */
    orderHistory?: boolean;
}

/**
 * @description
 * Dev mode: emails are written to `outputPath` instead of being sent, the Dashboard's Emails page
 * shows them in an outbox, and the endpoints used by the `vendure email` CLI are served at `route`.
 *
 * @docsCategory core plugins/Email
 * @since 4.0.0
 */
export interface EmailPluginDevModeOptions extends Omit<EmailPluginOptions, 'transport'> {
    devMode: true;
    outputPath: string;
    route: string;
}

export type InitializedEmailPluginOptions = (EmailPluginOptions | EmailPluginDevModeOptions) & {
    templateLoaders: EmailTemplateLoader[];
};

export type EmailTransportOptions =
    | SMTPTransportOptions
    | SendmailTransportOptions
    | FileTransportOptions
    | NoopTransportOptions
    | SESTransportOptions
    | TestingTransportOptions;

export interface SMTPTransportOptions extends SMTPTransport.Options {
    type: 'smtp';
    logging?: boolean;
    pool?: boolean;
    maxConnections?: SMTPPool.Options['maxConnections'];
    maxMessages?: SMTPPool.Options['maxMessages'];
    rateDelta?: SMTPPool.Options['rateDelta'];
    rateLimit?: SMTPPool.Options['rateLimit'];
}

export interface SESTransportOptions extends SESTransport.Options {
    type: 'ses';
}

export interface SendmailTransportOptions {
    type: 'sendmail';
    path?: string;
    newline?: string;
}

export interface FileTransportOptions {
    type: 'file';
    outputPath: string;
    raw?: boolean;
}

export interface NoopTransportOptions {
    type: 'none';
}

export interface TestingTransportOptions {
    type: 'testing';
    onSend: (details: EmailDetails) => void;
}

export interface EmailDetails<Type extends 'serialized' | 'unserialized' = 'unserialized'> {
    from: string;
    recipient: string;
    subject: string;
    body: string;
    text?: string;
    attachments: Array<Type extends 'serialized' ? SerializedAttachment : Attachment>;
    cc?: string;
    bcc?: string;
    replyTo?: string;
}

export type OptionalToNullable<O> = {
    [K in keyof O]-?: undefined extends O[K] ? NonNullable<O[K]> | null : O[K];
};

export type EmailAttachment = Omit<Attachment, 'raw'> & { path?: string };

export type SerializedAttachment = OptionalToNullable<
    Omit<EmailAttachment, 'content'> & { content: string | null }
>;

export type EmailMetadata = Record<string, any>;

/**
 * @description
 * The data of a queued email. It goes through the job queue, so everything in it is JSON.
 */
export interface EmailJobData {
    ctx: SerializedRequestContext;
    type: string;
    from: string;
    recipient: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    templateVars: Record<string, any>;
    languageCode: string;
    channelCode: string;
    attachments: SerializedAttachment[];
    metadata?: EmailMetadata;
    /** Set by the dev API so the caller can find the outbox entry of this send. */
    devCorrelationId?: string;
}
