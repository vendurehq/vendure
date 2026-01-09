import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, DefaultSearchPlugin, LanguageCode, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import localtunnel from 'localtunnel';
import path from 'path';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { molliePaymentHandler } from '../package/mollie/mollie.handler';
import { MolliePlugin } from '../src/mollie';

import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import { ADD_ITEM_TO_ORDER, APPLY_COUPON_CODE } from './graphql/shop-queries';
import { setShipping } from './payment-helpers';

/**
 * This should only be used to locally test the Mollie payment plugin
 * Make sure you have `MOLLIE_APIKEY=test_xxxx` in your .env file
 */
/* eslint-disable @typescript-eslint/no-floating-promises */
async function runMollieDevServer() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config();

    registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));
    const tunnel = await localtunnel({ port: 3050 });
    const config = mergeConfig(testConfig, {
        plugins: [
            ...testConfig.plugins,
            DefaultSearchPlugin,
            AdminUiPlugin.init({
                route: 'admin',
                port: 5001,
            }),
            MolliePlugin.init({ vendureHost: tunnel.url }),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
        apiOptions: {
            adminApiPlayground: true,
            shopApiPlayground: true,
        },
    });
    const { server, shopClient, adminClient } = createTestEnvironment(config as any);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });
    // Set EUR as currency for Mollie
    await adminClient.asSuperAdmin();
    await adminClient.query(gql`
        mutation {
            updateChannel(input: { id: "T_1", currencyCode: EUR }) {
                __typename
            }
        }
    `);
    // Create method
    await adminClient.query(
        CREATE_PAYMENT_METHOD,
        {
            input: {
                code: 'mollie',
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Mollie payment test',
                        description: 'This is a Mollie test payment method',
                    },
                ],
                enabled: true,
                handler: {
                    code: molliePaymentHandler.code,
                    arguments: [
                        {
                            name: 'redirectUrl',
                            value: `${tunnel.url}/admin/orders?filter=open&page=1`,
                        },
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        { name: 'apiKey', value: process.env.MOLLIE_APIKEY! },
                    ],
                },
            },
        },
    );
    // Prepare a test order where the total is 0
    await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
    await shopClient.query(ADD_ITEM_TO_ORDER, {
        productVariantId: 'T_1',
        quantity: 1,
    });
    await setShipping(shopClient);
    await shopClient.query(APPLY_COUPON_CODE, { couponCode: 'FREE_SHIPPING' });

    // Create Payment Intent
    const result = await shopClient.query(CREATE_MOLLIE_PAYMENT_INTENT, {
        input: {
            locale: 'nl_NL',
            immediateCapture: false,
        },
    });
    // eslint-disable-next-line no-console
    console.log('Payment intent result', result);

    // Uncomme this line to disable webhook processing and test the `syncMolliePaymentStatus` mutation
    MolliePlugin.options.disableWebhookProcessing = true;
}

(async () => {
    await runMollieDevServer();
})();


const CREATE_MOLLIE_PAYMENT_INTENT = gql`
    mutation createMolliePaymentIntent($input: MolliePaymentIntentInput!) {
        createMolliePaymentIntent(input: $input) {
            ... on MolliePaymentIntent {
                url
            }
        }
    }
`;