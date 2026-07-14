/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { ResultOf } from './graphql/graphql-admin';
import { FragmentOf as ShopFragmentOf } from './graphql/graphql-shop';
import {
    assignProductToChannelDocument,
    createChannelDocument,
    getCustomerListDocument,
    getOrdersListDocument,
    getProductWithVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderDocument,
    getOrderShopDocument,
    testOrderFragment,
    updatedOrderFragment,
} from './graphql/shop-definitions';

describe('Channelaware orders', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    const SECOND_CHANNEL_TOKEN = 'second_channel_token';
    const THIRD_CHANNEL_TOKEN = 'third_channel_token';
    let customerUser: ResultOf<typeof getCustomerListDocument>['customers']['items'][number];
    let product1: ResultOf<typeof getProductWithVariantsDocument>['product'];
    let product2: ResultOf<typeof getProductWithVariantsDocument>['product'];
    let order1Id: string;
    let order2Id: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { take: 1 },
        });
        customerUser = customers.items[0];
        await shopClient.asUserWithCredentials(customerUser.emailAddress, 'test');

        await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });

        await adminClient.query(createChannelDocument, {
            input: {
                code: 'third-channel',
                token: THIRD_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });

        product1 = (
            await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            })
        ).product!;

        await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: 'T_2',
                productIds: [product1.id],
            },
        });

        product2 = (
            await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_2',
            })
        ).product!;

        await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: 'T_3',
                productIds: [product2.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    type UpdatedOrderFragment = ShopFragmentOf<typeof updatedOrderFragment>;
    const orderResultGuard: ErrorResultGuard<UpdatedOrderFragment> = createErrorResultGuard(
        input => !!input.lines,
    );

    type TestOrderFragment = ShopFragmentOf<typeof testOrderFragment>;
    const activeOrderGuard: ErrorResultGuard<TestOrderFragment> = createErrorResultGuard(
        input => !!input.lines,
    );

    it('creates order on current channel', async () => {
        shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: product1!.variants[0].id,
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines.length).toBe(1);
        expect(addItemToOrder.lines[0].quantity).toBe(1);
        expect(addItemToOrder.lines[0].productVariant.id).toBe(product1!.variants[0].id);

        order1Id = addItemToOrder.id;
    });

    it('sets active order to null when switching channel', async () => {
        shopClient.setChannelToken(THIRD_CHANNEL_TOKEN);
        const result = await shopClient.query(getActiveOrderDocument);
        expect(result.activeOrder).toBeNull();
    });

    it('creates new order on current channel when already active order on other channel', async () => {
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: product2!.variants[0].id,
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines.length).toBe(1);
        expect(addItemToOrder.lines[0].quantity).toBe(1);
        expect(addItemToOrder.lines[0].productVariant.id).toBe(product2!.variants[0].id);

        order2Id = addItemToOrder.id;
    });

    it('goes back to most recent active order when switching channel', async () => {
        shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);
        activeOrderGuard.assertSuccess(activeOrder);
        expect(activeOrder.id).toBe(order1Id);
    });

    it('returns null when requesting order from other channel', async () => {
        const result = await shopClient.query(getOrderShopDocument, {
            id: order2Id,
        });
        expect(result.order).toBeNull();
    });

    it('returns order when requesting order from correct channel', async () => {
        const result = await shopClient.query(getOrderShopDocument, {
            id: order1Id,
        });
        expect(result.order!.id).toBe(order1Id);
    });

    it('returns all orders on default channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const result = await adminClient.query(getOrdersListDocument);
        expect(result.orders.items.map(o => o.id).sort()).toEqual([order1Id, order2Id]);
    });

    it('returns only channel specific orders when on other than default channel', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const result = await adminClient.query(getOrdersListDocument);
        expect(result.orders.items.map(o => o.id)).toEqual([order1Id]);
    });
});
