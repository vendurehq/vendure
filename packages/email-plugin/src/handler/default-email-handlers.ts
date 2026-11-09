/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    AccountRegistrationEvent,
    AdministratorPasswordResetEvent,
    ConfigService,
    EntityHydrator,
    IdentifierChangeRequestEvent,
    Injector,
    Logger,
    NativeAuthenticationMethod,
    Order,
    OrderStateTransitionEvent,
    PasswordResetEvent,
    RequestContext,
    ShippingLine,
} from '@vendure/core';
import { Request } from 'express';

import { EMAIL_PLUGIN_OPTIONS, loggerCtx } from '../constants';
import { EmailEventListener } from '../event-listener';
import { EmailPluginOptions } from '../types';

import { EmailEventHandler } from './event-handler';
import {
    mockAccountRegistrationEvent,
    mockAdminPasswordResetEvent,
    mockEmailAddressChangeEvent,
    mockOrderStateTransitionEvent,
    mockPasswordResetEvent,
} from './mock-events';

export const orderConfirmationHandler = new EmailEventListener('order-confirmation')
    .on(OrderStateTransitionEvent)
    .filter(
        event =>
            event.toState === 'PaymentSettled' && event.fromState !== 'Modifying' && !!event.order.customer,
    )
    .loadData(async ({ event, injector }) => {
        const entityHydrator = injector.get(EntityHydrator);
        await entityHydrator.hydrate(event.ctx, event.order, {
            relations: ['lines.featuredAsset', 'shippingLines.shippingMethod'],
        });

        transformOrderLineAssetUrls(event.ctx, event.order, injector);
        const shippingLines = shippingLinesWithMethod(event.order);
        return { shippingLines };
    })
    .setRecipient(event => event.order.customer!.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Order confirmation for #{{ order.code }}')
    .setTemplateVars(event => ({ order: event.order, shippingLines: event.data.shippingLines }))
    .setMockEvent(mockOrderStateTransitionEvent);

export const emailVerificationHandler = new EmailEventListener('email-verification')
    .on(AccountRegistrationEvent)
    .filter(event => !!event.user.getNativeAuthenticationMethod().identifier)
    .filter(event => {
        const nativeAuthMethod = event.user.authenticationMethods.find(
            m => m instanceof NativeAuthenticationMethod,
        );
        return (nativeAuthMethod && !!nativeAuthMethod.identifier) || false;
    })
    .setRecipient(event => event.user.identifier)
    .setFrom('{{ fromAddress }}')
    .setSubject('Please verify your email address')
    .setTemplateVars(event => ({
        verificationToken: event.user.getNativeAuthenticationMethod().verificationToken,
    }))
    .setMockEvent(mockAccountRegistrationEvent);

export const passwordResetHandler = new EmailEventListener('password-reset')
    .on(PasswordResetEvent)
    .setRecipient(event => event.user.identifier)
    .setFrom('{{ fromAddress }}')
    .setSubject('Forgotten password reset')
    .setTemplateVars(event => ({
        passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken,
    }))
    .setMockEvent(mockPasswordResetEvent);

export const adminPasswordResetHandler = new EmailEventListener('admin-password-reset')
    .on(AdministratorPasswordResetEvent)
    .loadData(async ({ injector }) => {
        // Existing projects will not have this variable set when upgrading, in which case
        // the reset link in the email would silently render as a dead relative URL.
        const { globalTemplateVars } = injector.get<EmailPluginOptions>(EMAIL_PLUGIN_OPTIONS);
        if (typeof globalTemplateVars !== 'function' && globalTemplateVars?.adminPasswordResetUrl == null) {
            Logger.warn(
                'The "adminPasswordResetUrl" global template variable is not set, so the reset link in the ' +
                    '"admin-password-reset" email will not work. Set it in the EmailPlugin `globalTemplateVars` ' +
                    'to the URL of your Dashboard password reset page, e.g. "https://my-server.com/dashboard/reset-password".',
                loggerCtx,
            );
        }
        return {};
    })
    .setRecipient(event => event.administrator.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Forgotten password reset')
    .setTemplateVars(event => ({
        passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken,
    }))
    .setMockEvent(mockAdminPasswordResetEvent);

export const emailAddressChangeHandler = new EmailEventListener('email-address-change')
    .on(IdentifierChangeRequestEvent)
    .setRecipient(event => event.user.getNativeAuthenticationMethod().pendingIdentifier!)
    .setFrom('{{ fromAddress }}')
    .setSubject('Please verify your change of email address')
    .setTemplateVars(event => ({
        identifierChangeToken: event.user.getNativeAuthenticationMethod().identifierChangeToken,
    }))
    .setMockEvent(mockEmailAddressChangeEvent);

export const defaultEmailHandlers: Array<EmailEventHandler<any, any>> = [
    orderConfirmationHandler,
    emailVerificationHandler,
    passwordResetHandler,
    adminPasswordResetHandler,
    emailAddressChangeHandler,
];

/**
 * @description
 * Applies the configured `AssetStorageStrategy.toAbsoluteUrl()` function to each of the
 * OrderLine's `featuredAsset.preview` properties, so that they can be correctly displayed
 * in the email template.
 * This is required since that step usually happens at the API in middleware, which is not
 * applicable in this context. So we need to do it manually.
 *
 * **Note: Mutates the Order object**
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email utils
 */
export function transformOrderLineAssetUrls(ctx: RequestContext, order: Order, injector: Injector): Order {
    const { assetStorageStrategy } = injector.get(ConfigService).assetOptions;
    if (assetStorageStrategy.toAbsoluteUrl) {
        const toAbsoluteUrl = assetStorageStrategy.toAbsoluteUrl.bind(assetStorageStrategy);
        for (const line of order.lines) {
            if (line.featuredAsset) {
                line.featuredAsset.preview = toAbsoluteUrl(ctx.req as Request, line.featuredAsset.preview);
            }
        }
    }
    return order;
}

/**
 * @description
 * Ensures that the ShippingLines have a shippingMethod so that we can use the
 * `shippingMethod.name` property in the email template.
 *
 * @docsCategory core plugins/EmailPlugin
 * @docsPage Email utils
 */
export function shippingLinesWithMethod(order: Order): ShippingLine[] {
    const shippingLines: ShippingLine[] = [];

    for (const line of order.shippingLines || []) {
        if (line.shippingMethod) {
            shippingLines.push(line);
        }
    }
    return shippingLines;
}
