import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Type } from '@vendure/common/lib/shared-types';
import { Injector, Order, RequestContext } from '@vendure/core';

import { serializeAttachments } from './attachment-utils';
import { EmailTemplate } from './template/email-template';
import {
    EmailAttachment,
    EmailJobData,
    EmailMetadata,
    EventWithContext,
    GlobalTemplateVars,
} from './types';

/**
 * @description
 * The input of the functions of an {@link EmailDefinition} that run after `data()`.
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export interface EmailFnInput<Event, Data> {
    event: Event;
    data: Data;
    ctx: RequestContext;
    injector: Injector;
}

/**
 * @description
 * The recipient fields of an email. `recipient` may return a plain address instead.
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export interface EmailAddresses {
    to: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
}

/**
 * @description
 * One thing an email can be about for a given order: the order itself, one fulfillment, one payment
 * or one refund. The dashboard lists these on the order detail page.
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export interface OrderEmailTarget {
    /** Identifies the target within the order, e.g. the fulfillment ID. */
    id: string;
    /** Shown in the dashboard, e.g. "Fulfillment #3 (DHL 1Z999)". */
    label: string;
    /** Whether the email can be sent for this target, given its current state. */
    eligible: boolean;
    /** Why the email cannot be sent, when `eligible` is false. */
    reason?: string;
}

/**
 * @description
 * Lets an email be sent by hand from the order detail page. `targets()` lists what the email can be
 * about and whether the current state allows it. `createEvent()` builds the event the email would
 * have received, which then goes through the same pipeline as an automatic send.
 *
 * The order passed in has `customer`, `payments`, `payments.refunds` and `fulfillments` loaded.
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export interface OrderEmailSend<Event> {
    targets: (input: {
        ctx: RequestContext;
        injector: Injector;
        order: Order;
    }) => OrderEmailTarget[] | Promise<OrderEmailTarget[]>;
    createEvent: (input: {
        ctx: RequestContext;
        injector: Injector;
        order: Order;
        targetId: string;
    }) => Event | Promise<Event>;
}

/**
 * @description
 * Builds an event from database data, for previews and the `vendure email` CLI. `args` come from
 * `--arg key=value`. Return `undefined` when there is no suitable data.
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export type SampleEventFn<Event> = (input: {
    ctx: RequestContext;
    injector: Injector;
    args: Record<string, string>;
}) => Event | undefined | Promise<Event | undefined>;

/**
 * @description
 * An email: which event sends it, who receives it, what data the template gets, and the template.
 * Create one with {@link defineEmail}. A definition is a plain object, so customise a default
 * email by spreading it:
 *
 * ```ts
 * const orderConfirmation = defineEmail({ ...orderConfirmationEmail, template: MyTemplate });
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export interface EmailDefinition<Event extends EventWithContext = EventWithContext, Data extends object = any> {
    /** Unique name of the email, e.g. `'order-confirmation'`. */
    type: string;
    /** Human-readable name for the dashboard and CLI, e.g. "Order confirmation". */
    label?: string;
    /** The event that sends the email. */
    event: Type<Event>;
    /** Return false to not send the email for this event. */
    filter?: (event: Event) => boolean;
    /**
     * The template's data. Runs in the server process, before the email is queued. The template
     * receives the result merged with the global template variables, after JSON serialisation.
     */
    data?: (input: { event: Event; ctx: RequestContext; injector: Injector }) => Data | Promise<Data>;
    recipient: (input: EmailFnInput<Event, Data>) => string | EmailAddresses | Promise<string | EmailAddresses>;
    /** The language of the email. Defaults to the language of the event's RequestContext. */
    languageCode?: (input: EmailFnInput<Event, Data>) => LanguageCode | undefined;
    /** Overrides the plugin's `defaultFrom`. May contain `{{ path }}` placeholders. */
    from?: string;
    attachments?: (input: EmailFnInput<Event, Data>) => EmailAttachment[] | Promise<EmailAttachment[]>;
    metadata?: (input: EmailFnInput<Event, Data>) => EmailMetadata | Promise<EmailMetadata>;
    template: EmailTemplate<Data & GlobalTemplateVars>;
    sample?: SampleEventFn<Event>;
    orderSend?: OrderEmailSend<Event>;
}

/**
 * @description
 * Defines an email. See {@link EmailDefinition}.
 *
 * @example
 * ```ts
 * export const welcomeEmail = defineEmail({
 *     type: 'welcome',
 *     label: 'Welcome',
 *     event: AccountVerifiedEvent,
 *     data: ({ event }) => ({ firstName: event.customer.firstName }),
 *     recipient: ({ event }) => event.customer.emailAddress,
 *     template: WelcomeTemplate,
 * });
 * ```
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export function defineEmail<Event extends EventWithContext, Data extends object = Record<string, never>>(
    definition: EmailDefinition<Event, Data>,
): EmailDefinition<Event, Data> {
    return definition;
}

/**
 * @description
 * The data type of an email definition, e.g. `EmailData<typeof orderConfirmationEmail>`. Use it to
 * type a custom template from the definition it belongs to.
 *
 * @docsCategory core plugins/Email
 * @docsPage defineEmail
 * @since 4.0.0
 */
export type EmailData<D> = D extends EmailDefinition<any, infer Data> ? Data & GlobalTemplateVars : never;

export type PrepareEmailResult =
    | { status: 'ready'; job: EmailJobData }
    | { status: 'filtered' }
    | { status: 'failed'; stage: 'data' | 'recipient'; error: unknown };

/**
 * Runs an email definition for one event and returns the job to queue. Shared by automatic sends,
 * sends from the dashboard and the dev tooling, so they all behave the same.
 */
export async function prepareEmail(
    definition: EmailDefinition<any, any>,
    event: EventWithContext,
    options: { injector: Injector; globals: GlobalTemplateVars; defaultFrom: string; skipFilter?: boolean },
): Promise<PrepareEmailResult> {
    if (!options.skipFilter && definition.filter && !definition.filter(event)) {
        return { status: 'filtered' };
    }
    const { ctx } = event;
    const { injector } = options;
    let data: any;
    try {
        data = definition.data ? await definition.data({ event, ctx, injector }) : {};
    } catch (error) {
        return { status: 'failed', stage: 'data', error };
    }
    const input = { event, data, ctx, injector };
    let addresses: EmailAddresses;
    try {
        const recipient = await definition.recipient(input);
        addresses = typeof recipient === 'string' ? { to: recipient } : recipient;
        if (!addresses?.to) {
            throw new Error(`The recipient function of the "${definition.type}" email returned no address`);
        }
    } catch (error) {
        return { status: 'failed', stage: 'recipient', error };
    }
    const languageCode = definition.languageCode?.(input) ?? ctx.languageCode;
    const attachments = await serializeAttachments((await definition.attachments?.(input)) ?? []);
    const metadata = (await definition.metadata?.(input)) ?? {};
    return {
        status: 'ready',
        job: {
            ctx: ctx.serialize(),
            type: definition.type,
            from: definition.from ?? options.defaultFrom,
            recipient: addresses.to,
            cc: addresses.cc,
            bcc: addresses.bcc,
            replyTo: addresses.replyTo,
            templateVars: { ...options.globals, ...data },
            languageCode,
            channelCode: ctx.channel.code,
            attachments,
            metadata,
        },
    };
}
