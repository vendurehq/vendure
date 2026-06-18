import { OnApplicationBootstrap } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    configureDefaultOrderProcess,
    DefaultProductVariantPriceUpdateStrategy,
    LanguageCode,
    PaymentMethod,
    PaymentMethodService,
    PluginCommonModule,
    RequestContextService,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import { MultivendorResolver } from './api/mv.resolver';
import { multivendorOrderProcess } from './config/mv-order-process';
import { MultivendorSellerStrategy } from './config/mv-order-seller-strategy';
import { multivendorPaymentMethodHandler } from './config/mv-payment-handler';
import { multivendorShippingEligibilityChecker } from './config/mv-shipping-eligibility-checker';
import { MultivendorShippingLineAssignmentStrategy } from './config/mv-shipping-line-assignment-strategy';
import { CONNECTED_PAYMENT_METHOD_CODE, MULTIVENDOR_PLUGIN_OPTIONS } from './constants';
import { MultivendorService } from './service/mv.service';
import { MultivendorPluginOptions } from './types';

/**
 * @description
 * This is an example of how to implement a multivendor marketplace app using the new features introduced in
 * Vendure v2.0.
 *
 * ## Setup
 *
 * Add this plugin to your VendureConfig:
 * ```ts
 *  plugins: [
 *    MultivendorPlugin.init({
 *        platformFeePercent: 10,
 *        platformFeeSKU: 'FEE',
 *    }),
 *    // ...
 *  ]
 * ```
 *
 * ## Create a Seller
 *
 * Now you can create new sellers with the following mutation:
 *
 * ```graphql
 * mutation RegisterSeller {
 *   registerNewSeller(input: {
 *     shopName: "Bob's Parts",
 *     seller {
 *       firstName: "Bob"
 *       lastName: "Dobalina"
 *       emailAddress: "bob@bobs-parts.com"
 *       password: "test",
 *     }
 *   }) {
 *     id
 *     code
 *     token
 *   }
 * }
 * ```
 *
 * This mutation will:
 *
 * - Create a new Seller representing the shop "Bob's Parts"
 * - Create a new Channel and associate it with the new Seller
 * - Create a Role & Administrator for Bob to access his shop admin account
 * - Create a ShippingMethod for Bob's shop
 * - Create a StockLocation for Bob's shop
 *
 * Bob can then go and sign in to the Admin UI using the provided emailAddress & password credentials, and start
 * creating some products.
 *
 * Repeat this process for more Sellers.
 *
 * ## Storefront
 *
 * To create a multivendor Order, use the default Channel in the storefront and add variants to an Order from
 * various Sellers.
 *
 * ### Shipping
 *
 * When it comes to setting the shipping method, the `eligibleShippingMethods` query should just return the
 * shipping methods for the shops from which the OrderLines come. So assuming the Order contains items from 3 different
 * Sellers, there should be at least 3 eligible ShippingMethods (plus any global ones from the default Channel).
 *
 * You should now select the IDs of all the Seller-specific ShippingMethods:
 *
 * ```graphql
 * mutation {
 *   setOrderShippingMethod(shippingMethodId: ["3", "4"]) {
 *     ... on Order {
 *       id
 *     }
 *   }
 * }
 * ```
 *
 * ### Payment
 *
 * This plugin automatically creates a "connected payment method" in the default Channel, which is a simple simulation
 * of something like Stripe Connect.
 *
 * ```graphql
 * mutation {
 *   addPaymentToOrder(input: { method: "connected-payment-method", metadata: {} }) {
 *     ... on Order { id }
 *     ... on ErrorResult {
 *       errorCode
 *       message
 *     }
 *     ... on PaymentFailedError {
 *       paymentErrorMessage
 *     }
 *   }
 * }
 * ```
 *
 * After that, you should be able to see that the Order has been split into an "aggregate" order in the default Channel,
 * and then one or more "seller" orders in each Channel from which the customer bought items.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.customFields.Seller.push({
            name: 'connectedAccountId',
            label: [{ languageCode: LanguageCode.en, value: 'Connected account ID' }],
            description: [
                { languageCode: LanguageCode.en, value: 'The ID used to process connected payments' },
            ],
            type: 'string',
            public: false,
        });
        config.paymentOptions.paymentMethodHandlers.push(multivendorPaymentMethodHandler);

        const customDefaultOrderProcess = configureDefaultOrderProcess({
            checkFulfillmentStates: false,
        });
        config.orderOptions.process = [customDefaultOrderProcess, multivendorOrderProcess];
        config.orderOptions.orderSellerStrategy = new MultivendorSellerStrategy();
        config.catalogOptions.productVariantPriceUpdateStrategy =
            new DefaultProductVariantPriceUpdateStrategy({
                syncPricesAcrossChannels: true,
            });
        config.shippingOptions.shippingEligibilityCheckers.push(multivendorShippingEligibilityChecker);
        config.shippingOptions.shippingLineAssignmentStrategy =
            new MultivendorShippingLineAssignmentStrategy();
        return config;
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [MultivendorResolver],
    },
    providers: [
        MultivendorService,
        { provide: MULTIVENDOR_PLUGIN_OPTIONS, useFactory: () => MultivendorPlugin.options },
    ],
})
export class MultivendorPlugin implements OnApplicationBootstrap {
    static options: MultivendorPluginOptions;

    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private requestContextService: RequestContextService,
        private paymentMethodService: PaymentMethodService,
    ) {}

    static init(options: MultivendorPluginOptions) {
        MultivendorPlugin.options = options;
        return MultivendorPlugin;
    }

    async onApplicationBootstrap() {
        await this.ensureConnectedPaymentMethodExists();
    }

    private async ensureConnectedPaymentMethodExists() {
        const paymentMethod = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: {
                code: CONNECTED_PAYMENT_METHOD_CODE,
            },
        });
        if (!paymentMethod) {
            const ctx = await this.requestContextService.create({ apiType: 'admin' });
            const allChannels = await this.connection.getRepository(ctx, Channel).find();
            const createdPaymentMethod = await this.paymentMethodService.create(ctx, {
                code: CONNECTED_PAYMENT_METHOD_CODE,
                enabled: true,
                handler: {
                    code: multivendorPaymentMethodHandler.code,
                    arguments: [],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Connected Payments',
                    },
                ],
            });
            await this.channelService.assignToChannels(
                ctx,
                PaymentMethod,
                createdPaymentMethod.id,
                allChannels.map(c => c.id),
            );
        }
    }
}
