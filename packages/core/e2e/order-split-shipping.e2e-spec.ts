/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    ChannelService,
    EntityHydrator,
    idsAreEqual,
    Injector,
    mergeConfig,
    Order,
    OrderLine,
    OrderSellerStrategy,
    RequestContext,
    SplitOrderContents,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { FragmentOf } from './graphql/graphql-shop';
import { assignProductToChannelDocument, createChannelDocument } from './graphql/shared-definitions';
import {
    activeOrderCustomerDocument,
    addItemToOrderDocument,
    addPaymentDocument,
    getEligibleShippingMethodsDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderFragment,
    testOrderWithPaymentsFragment,
    transitionToStateDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';

/**
 * A minimal OrderSellerStrategy which splits the Order by the seller Channel of each OrderLine,
 * i.e. what a real multivendor implementation does. Deliberately does not use the multivendor
 * example plugin, so that this spec exercises core behaviour only.
 */
class TestSellerStrategy implements OrderSellerStrategy {
    private channelService: ChannelService;
    private entityHydrator: EntityHydrator;

    init(injector: Injector) {
        this.channelService = injector.get(ChannelService);
        this.entityHydrator = injector.get(EntityHydrator);
    }

    async setOrderLineSellerChannel(ctx: RequestContext, orderLine: OrderLine) {
        await this.entityHydrator.hydrate(ctx, orderLine.productVariant, { relations: ['channels'] });
        const defaultChannel = await this.channelService.getDefaultChannel();
        // A ProductVariant assigned to exactly 2 Channels belongs to the default Channel and
        // one seller Channel.
        if (orderLine.productVariant.channels?.length === 2) {
            return orderLine.productVariant.channels.find(c => !idsAreEqual(c.id, defaultChannel.id));
        }
    }

    async splitOrder(ctx: RequestContext, order: Order): Promise<SplitOrderContents[]> {
        const partialOrders = new Map<string, SplitOrderContents>();
        for (const line of order.lines) {
            if (!line.sellerChannelId) {
                continue;
            }
            const key = line.sellerChannelId.toString();
            let partialOrder = partialOrders.get(key);
            if (!partialOrder) {
                partialOrder = {
                    channelId: line.sellerChannelId,
                    shippingLines: [],
                    lines: [],
                    state: 'ArrangingPayment',
                };
                partialOrders.set(key, partialOrder);
            }
            partialOrder.lines.push(line);
        }
        for (const partialOrder of partialOrders.values()) {
            const shippingLineIds = new Set(partialOrder.lines.map(l => l.shippingLineId));
            partialOrder.shippingLines = order.shippingLines.filter(sl => shippingLineIds.has(sl.id));
        }
        return [...partialOrders.values()];
    }
}

const GET_SHIPPING_METHODS = gql`
    query {
        shippingMethods {
            items {
                id
                code
            }
        }
    }
`;

const CREATE_PROMOTION = gql`
    mutation ($input: CreatePromotionInput!) {
        createPromotion(input: $input) {
            ... on Promotion {
                id
                name
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const GET_SELLER_ORDER_SHIPPING = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            sellerOrders {
                id
                shippingWithTax
                channels {
                    code
                }
                shippingLines {
                    priceWithTax
                    shippingMethod {
                        code
                    }
                }
            }
        }
    }
`;

// https://github.com/vendurehq/vendure/issues/4117
// Seller Order price adjustments are applied in a RequestContext scoped to the seller Channel,
// which also scopes ShippingMethod resolution (ShippingMethodService.findOne is channel-scoped).
// A ShippingMethod which exists only in the default Channel must not be dropped from the seller
// Order as a result.
describe('Order splitting with a default-Channel-only ShippingMethod', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderSellerStrategy: new TestSellerStrategy(),
            },
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    let sellerChannelId: string;
    let sellerVariantId: string;
    let shippingMethodCode: string;
    let orderId: string;
    let aggregateShippingWithTax: number;
    let secondOrderId: string;

    type OrderSuccessResult =
        | FragmentOf<typeof updatedOrderFragment>
        | FragmentOf<typeof testOrderFragment>
        | FragmentOf<typeof testOrderWithPaymentsFragment>
        | FragmentOf<typeof activeOrderCustomerDocument>;
    const orderResultGuard: ErrorResultGuard<OrderSuccessResult> = createErrorResultGuard(
        input => !!input.lines,
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('sets up a seller Channel with a product', async () => {
        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'seller-channel',
                token: 'seller-channel-token',
                defaultLanguageCode: 'en',
                currencyCode: 'USD',
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
                sellerId: 'T_1',
            },
        });
        sellerChannelId = (createChannel as { id: string }).id;

        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: sellerChannelId, productIds: ['T_1'], priceFactor: 1 },
        });
        sellerVariantId = assignProductsToChannel[0].variants[0].id;

        // Guard against a false pass: the ShippingMethods from the seed data must exist in the
        // default Channel and NOT in the seller Channel, which is the whole point of this spec.
        const inDefault = await adminClient.query(GET_SHIPPING_METHODS);
        expect(inDefault.shippingMethods.items.length).toBeGreaterThan(0);
        shippingMethodCode = inDefault.shippingMethods.items[0].code;

        adminClient.setChannelToken('seller-channel-token');
        const inSeller = await adminClient.query(GET_SHIPPING_METHODS);
        expect(inSeller.shippingMethods.items).toEqual([]);
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('places an Order using a ShippingMethod which is only in the default Channel', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: sellerVariantId,
            quantity: 1,
        });
        await shopClient.query(setShippingAddressDocument, {
            input: { streetLine1: '12 the street', postalCode: '123456', countryCode: 'US' },
        });

        const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
            id: [eligibleShippingMethods[0].id],
        });
        orderResultGuard.assertSuccess(setOrderShippingMethod);
        expect(setOrderShippingMethod.shippingWithTax).toBeGreaterThan(0);
        aggregateShippingWithTax = setOrderShippingMethod.shippingWithTax;

        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        orderResultGuard.assertSuccess(transitionOrderToState);

        const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });
        orderResultGuard.assertSuccess(addPaymentToOrder);
        orderId = addPaymentToOrder.id;
    });

    it('the seller Order keeps its ShippingLine', async () => {
        const { order } = await adminClient.query(GET_SELLER_ORDER_SHIPPING, { id: orderId });
        expect(order.sellerOrders.length).toBe(1);
        const sellerOrder = order.sellerOrders[0];
        expect(sellerOrder.channels.map((c: { code: string }) => c.code)).toContain('seller-channel');
        expect(sellerOrder.shippingLines.length).toBe(1);
        expect(sellerOrder.shippingLines[0].shippingMethod.code).toBe(shippingMethodCode);
        // The ShippingLine carries over at exactly the price calculated on the aggregate Order.
        expect(sellerOrder.shippingWithTax).toBe(aggregateShippingWithTax);
        expect(sellerOrder.shippingLines[0].priceWithTax).toBe(aggregateShippingWithTax);
    });

    // A shipping Promotion assigned only to the default Channel must not discount the seller
    // Order's shipping: the ShippingLine adjustments are duplicated from the aggregate Order, so
    // they have to be re-evaluated against the seller Channel's Promotions.
    it('a default-Channel shipping Promotion does not discount the seller Order', async () => {
        const { createPromotion } = await adminClient.query(CREATE_PROMOTION, {
            input: {
                enabled: true,
                conditions: [
                    {
                        code: 'minimum_order_amount',
                        arguments: [
                            { name: 'amount', value: '1' },
                            { name: 'taxInclusive', value: 'true' },
                        ],
                    },
                ],
                actions: [{ code: 'free_shipping', arguments: [] }],
                translations: [{ languageCode: 'en', name: 'default channel free shipping' }],
            },
        });
        expect(createPromotion.errorCode, createPromotion.message).toBeUndefined();
        expect(createPromotion.name).toBe('default channel free shipping');

        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: sellerVariantId,
            quantity: 1,
        });
        await shopClient.query(setShippingAddressDocument, {
            input: { streetLine1: '12 the street', postalCode: '123456', countryCode: 'US' },
        });
        const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
            id: [eligibleShippingMethods[0].id],
        });
        orderResultGuard.assertSuccess(setOrderShippingMethod);
        // Guard against a false pass: the Promotion must actually be discounting the aggregate
        // Order's shipping, otherwise the seller Order assertion below proves nothing.
        expect(setOrderShippingMethod.shippingWithTax).toBe(0);

        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        orderResultGuard.assertSuccess(transitionOrderToState);
        const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });
        orderResultGuard.assertSuccess(addPaymentToOrder);
        secondOrderId = addPaymentToOrder.id;

        const { order } = await adminClient.query(GET_SELLER_ORDER_SHIPPING, { id: secondOrderId });
        const sellerOrder = order.sellerOrders[0];
        expect(sellerOrder.shippingLines.length).toBe(1);
        expect(sellerOrder.shippingWithTax).toBe(aggregateShippingWithTax);
    });
});
