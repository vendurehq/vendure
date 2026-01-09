import type { ListParameters } from '@mollie/api-client/dist/types/binders/methods/parameters';
import {
    Injector,
    Order,
    PluginCommonModule,
    RequestContext,
    RuntimeVendureConfig,
    VendurePlugin,
} from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api-extensions';
import { PLUGIN_INIT_OPTIONS } from './constants';
import { MollieCommonResolver } from './mollie.common-resolver';
import { MollieController } from './mollie.controller';
import { molliePaymentHandler } from './mollie.handler';
import { MollieService } from './mollie.service';
import { MollieShopResolver } from './mollie.shop-resolver';

export type AdditionalEnabledPaymentMethodsParams = Partial<Omit<ListParameters, 'resource'>>;

/**
 * @description
 * Configuration options for the Mollie payments plugin.
 *
 * @docsCategory core plugins/PaymentsPlugin
 * @docsPage MolliePlugin
 */
export interface MolliePluginOptions {
    /**
     * @description
     * The host of your Vendure server, e.g. `'https://my-vendure.io'`.
     * This is used by Mollie to send webhook events to the Vendure server
     */
    vendureHost: string;

    /**
     * @description
     * Provide additional parameters to the Mollie enabled payment methods API call. By default,
     * the plugin will already pass the `resource` parameter.
     *
     * For example, if you want to provide a `locale` and `billingCountry` for the API call, you can do so like this:
     *
     * **Note:** The `order` argument is possibly `null`, this could happen when you fetch the available payment methods
     * before the order is created.
     *
     * @example
     * ```ts
     * import { VendureConfig } from '\@vendure/core';
     * import { MolliePlugin, getLocale } from '\@vendure/payments-plugin/package/mollie';
     *
     * export const config: VendureConfig = {
     *   // ...
     *   plugins: [
     *     MolliePlugin.init({
     *       enabledPaymentMethodsParams: (injector, ctx, order) => {
     *         const locale = order?.billingAddress?.countryCode
     *             ? getLocale(order.billingAddress.countryCode, ctx.languageCode)
     *             : undefined;
     *
     *         return {
     *           locale,
     *           billingCountry: order?.billingAddress?.countryCode,
     *         },
     *       }
     *     }),
     *   ],
     * };
     * ```
     *
     * @since 2.2.0
     */
    enabledPaymentMethodsParams?: (
        injector: Injector,
        ctx: RequestContext,
        order: Order | null,
    ) => AdditionalEnabledPaymentMethodsParams | Promise<AdditionalEnabledPaymentMethodsParams>;
    /**
     * @description
     * Disable the processing of incoming Mollie webhooks. 
     * Handle with care! This will keep orders in 'AddingItems' state if you don't manually process the Mollie payments via the `syncMolliePaymentStatus` mutation.
     * 
     * @since 3.6.0
     */
    disableWebhookProcessing?: boolean;
}

/**
 * @description
 * Plugin to enable payments through the [Mollie platform](https://docs.mollie.com/).
 * This plugin uses the Order API from Mollie, not the Payments API.
 *
 * ## Requirements
 *
 * 1. You will need to create a Mollie account and get your apiKey in the dashboard.
 * 2. Install the Payments plugin and the Mollie client:
 *
 *     `yarn add \@vendure/payments-plugin \@mollie/api-client`
 *
 *     or
 *
 *     `npm install \@vendure/payments-plugin \@mollie/api-client`
 *
 * ## Setup
 *
 * 1. Add the plugin to your VendureConfig `plugins` array:
 *     ```ts
 *     import { MolliePlugin } from '\@vendure/payments-plugin/package/mollie';
 *
 *     // ...
 *
 *     plugins: [
 *       MolliePlugin.init({ vendureHost: 'https://yourhost.io/' }),
 *     ]
 *     ```
 * 2. Create a new PaymentMethod in the Admin UI, and select "Mollie payments" as the handler.
 * 3. Set your Mollie apiKey in the `API Key` field.
 * 4. Set the `Fallback redirectUrl` to the url that the customer should be redirected to after completing the payment.
 * You can override this url by passing the `redirectUrl` as an argument to the `createMolliePaymentIntent` mutation.
 *
 * ## Storefront usage
 *
 * In your storefront you add a payment to an order using the `createMolliePaymentIntent` mutation. In this example, our Mollie
 * PaymentMethod was given the code "mollie-payment-method". The `redirectUrl``is the url that is used to redirect the end-user
 * back to your storefront after completing the payment.
 *
 * ```GraphQL
 * mutation CreateMolliePaymentIntent {
 *   createMolliePaymentIntent(input: {
 *     redirectUrl: "https://storefront/order/1234XYZ" // Optional, the fallback redirect url set in the admin UI will be used if not provided
 *     paymentMethodCode: "mollie-payment-method" // Optional, the first method with Mollie as handler will be used if not provided
 *     molliePaymentMethodCode: "ideal", // Optional argument to skip the method selection in the hosted checkout
 *     locale: "nl_NL", // Optional, the browser language will be used by Mollie if not provided
 *     immediateCapture: true, // Optional, default is true, set to false if you expect the order fulfillment to take longer than 24 hours
 *   }) {
 *          ... on MolliePaymentIntent {
 *               url
 *           }
 *          ... on MolliePaymentIntentError {
 *               errorCode
 *               message
 *          }
 *   }
 * }
 * ```
 *
 * The response will contain
 * a redirectUrl, which can be used to redirect your customer to the Mollie
 * platform.
 *
 * 'molliePaymentMethodCode' is an optional parameter that can be passed to skip Mollie's hosted payment method selection screen
 * You can get available Mollie payment methods with the following query:
 *
 * ```GraphQL
 * {
 *  molliePaymentMethods(input: { paymentMethodCode: "mollie-payment-method" }) {
 *    id
 *    code
 *    description
 *    minimumAmount {
 *      value
 *      currency
 *    }
 *    maximumAmount {
 *      value
 *      currency
 *    }
 *    image {
 *      size1x
 *      size2x
 *      svg
 *    }
 *  }
 * }
 * ```
 *
 * After completing payment on the Mollie platform,
 * the user is redirected to the redirect url that was provided in the `createMolliePaymentIntent` mutation, e.g. `https://storefront/order/CH234X5`
 *
 * ## Pay later methods
 *
 * Mollie supports pay-later methods like 'Klarna Pay Later'. Pay-later methods are captured immediately after payment.
 *
 * If your order fulfillment time is longer than 24 hours You should pass `immediateCapture=false` to the `createMolliePaymentIntent` mutation.
 * This will transition your order to 'PaymentAuthorized' after the Mollie hosted checkout.
 * You need to manually capture the payment after the order is fulfilled, by settling existing payments, either via the admin UI or in custom code.
 *
 * Make sure to capture a payment within 28 days, after that the payment will be automaticallreleased.
 * See the [Mollie documentation](https://docs.mollie.com/docs/place-a-hold-for-a-payment#authorization-expiration-window)
 * for more information.
 *
 * ## ArrangingAdditionalPayment state
 *
 * In some rare cases, a customer can add items to the active order, while a Mollie checkout is still open,
 * for example by opening your storefront in another browser tab.
 * This could result in an order being in `ArrangingAdditionalPayment` status after the customer finished payment.
 * You should check if there is still an active order with status `ArrangingAdditionalPayment` on your order confirmation page,
 * and if so, allow your customer to pay for the additional items by creating another Mollie payment.
 *
 * @docsCategory core plugins/PaymentsPlugin
 * @docsPage MolliePlugin
 * @docsWeight 0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [MollieController],
    providers: [MollieService, { provide: PLUGIN_INIT_OPTIONS, useFactory: () => MolliePlugin.options }],
    configuration: (config: RuntimeVendureConfig) => {
        config.paymentOptions.paymentMethodHandlers.push(molliePaymentHandler);
        return config;
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [MollieCommonResolver, MollieShopResolver],
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [MollieCommonResolver],
    },
    compatibility: '^3.0.0',
})
export class MolliePlugin {
    static options: MolliePluginOptions;

    /**
     * @description
     * Initialize the mollie payment plugin
     * @param vendureHost is needed to pass to mollie for callback
     */
    static init(options: MolliePluginOptions): typeof MolliePlugin {
        this.options = options;
        return MolliePlugin;
    }
}
