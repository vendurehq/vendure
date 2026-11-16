/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { mergeConfig } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import { CONNECTED_PAYMENT_METHOD_CODE } from 'dev-server/example-plugins/multivendor-plugin/constants';
import { MultivendorPlugin } from 'dev-server/example-plugins/multivendor-plugin/multivendor.plugin';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { FragmentOf } from './graphql/graphql-shop';
import { assignProductToChannelDocument } from './graphql/shared-definitions';
import {
    activeOrderCustomerDocument,
    addItemToOrderDocument,
    addPaymentDocument,
    getEligibleShippingMethodsDocument,
    registerSellerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderFragment,
    testOrderWithPaymentsFragment,
    transitionToStateDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomShippingMethodFields {
        minPrice: number;
        maxPrice: number;
    }
}

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

const GET_PROMOTION_LIST = gql`
    query {
        promotions {
            items {
                id
                name
            }
        }
    }
`;

const GET_SELLER_ORDER_IDS = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            sellerOrders {
                id
            }
        }
    }
`;

const GET_ORDER_DISCOUNTS = gql`
    query ($id: ID!) {
        order(id: $id) {
            id
            channels {
                id
                code
            }
            lines {
                linePriceWithTax
                proratedLinePriceWithTax
            }
            discounts {
                description
                amount
                amountWithTax
            }
        }
    }
`;

describe('Multi-vendor order promotions', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [
                MultivendorPlugin.init({
                    platformFeePercent: 10,
                    platformFeeSKU: 'FEE',
                }),
            ],
        }),
    );

    let bobsPartsChannel: { id: string; token: string; variantIds: string[] };
    let alicesWaresChannel: { id: string; token: string; variantIds: string[] };
    let orderId: string;

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
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('setup sellers', async () => {
        const result1 = await shopClient.query(registerSellerDocument, {
            input: {
                shopName: "Bob's Parts",
                seller: {
                    firstName: 'Bob',
                    lastName: 'Dobalina',
                    emailAddress: 'bob@bobs-parts.com',
                    password: 'test',
                },
            },
        });
        bobsPartsChannel = result1.registerNewSeller;

        const result2 = await shopClient.query(registerSellerDocument, {
            input: {
                shopName: "Alice's Wares",
                seller: {
                    firstName: 'Alice',
                    lastName: 'Smith',
                    emailAddress: 'alice@alices-wares.com',
                    password: 'test',
                },
            },
        });
        alicesWaresChannel = result2.registerNewSeller;
    });

    it('assign products to sellers', async () => {
        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: bobsPartsChannel.id, productIds: ['T_1'], priceFactor: 1 },
        });
        bobsPartsChannel.variantIds = assignProductsToChannel[0].variants.map(v => v.id);

        const { assignProductsToChannel: result2 } = await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: alicesWaresChannel.id, productIds: ['T_11'], priceFactor: 1 },
        });
        alicesWaresChannel.variantIds = result2[0].variants.map(v => v.id);
    });

    it("creates a Promotion in Bob's Channel only", async () => {
        adminClient.setChannelToken(bobsPartsChannel.token);
        const { createPromotion } = await adminClient.query(CREATE_PROMOTION, {
            input: {
                enabled: true,
                translations: [{ languageCode: 'en', name: 'bobs 10% off', description: '' }],
                conditions: [
                    {
                        code: 'minimum_order_amount',
                        arguments: [
                            { name: 'amount', value: '1' },
                            { name: 'taxInclusive', value: 'false' },
                        ],
                    },
                ],
                actions: [
                    {
                        code: 'order_percentage_discount',
                        arguments: [{ name: 'discount', value: '10' }],
                    },
                ],
            },
        });
        // Surface the actual error if an ErrorResult comes back, rather than an unhelpful
        // "expected undefined to be defined".
        expect(createPromotion.errorCode, createPromotion.message).toBeUndefined();
        expect(createPromotion.name).toBe('bobs 10% off');

        // Assert the Promotion really is scoped to Bob's Channel, so that the assertion
        // at the end of this suite cannot pass for the wrong reason.
        const inBobs = await adminClient.query(GET_PROMOTION_LIST);
        expect(inBobs.promotions.items.map((p: { name: string }) => p.name)).toContain('bobs 10% off');

        adminClient.setChannelToken(alicesWaresChannel.token);
        const inAlices = await adminClient.query(GET_PROMOTION_LIST);
        expect(inAlices.promotions.items.map((p: { name: string }) => p.name)).not.toContain('bobs 10% off');

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('adds items from both sellers and sets shipping methods', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: bobsPartsChannel.variantIds[0],
            quantity: 1,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: alicesWaresChannel.variantIds[0],
            quantity: 1,
        });

        await shopClient.query(setShippingAddressDocument, {
            input: { streetLine1: '12 the street', postalCode: '123456', countryCode: 'US' },
        });

        const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
            id: [
                eligibleShippingMethods.find(m => m.code === 'bobs-parts-shipping')!.id,
                eligibleShippingMethods.find(m => m.code === 'alices-wares-shipping')!.id,
            ],
        });
        orderResultGuard.assertSuccess(setOrderShippingMethod);
    });

    it('completing checkout splits the order', async () => {
        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        orderResultGuard.assertSuccess(transitionOrderToState);

        const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
            input: { method: CONNECTED_PAYMENT_METHOD_CODE, metadata: {} },
        });
        orderResultGuard.assertSuccess(addPaymentToOrder);
        orderId = addPaymentToOrder.id;
    });

    // https://github.com/vendurehq/vendure/issues/4117
    it('applies the Promotion only to the seller Order in its own Channel', async () => {
        const { order: aggregate } = await adminClient.query(GET_SELLER_ORDER_IDS, { id: orderId });
        const sellerOrders: Array<{
            channels: Array<{ code: string }>;
            lines: Array<{ linePriceWithTax: number; proratedLinePriceWithTax: number }>;
            discounts: Array<{ description: string; amount: number; amountWithTax: number }>;
        }> = [];
        for (const sellerOrder of aggregate.sellerOrders) {
            const { order } = await adminClient.query(GET_ORDER_DISCOUNTS, { id: sellerOrder.id });
            sellerOrders.push(order);
        }
        expect(sellerOrders.length).toBe(2);

        const bobs = sellerOrders.find(o => o.channels.some(c => c.code === 'bobs-parts'))!;
        const alices = sellerOrders.find(o => o.channels.some(c => c.code === 'alices-wares'))!;

        expect(bobs.discounts.map(d => d.description)).toEqual(['bobs 10% off']);
        // The discount must be calculated against Bob's own seller Order, not the aggregate
        // Order. Bob's lines total 155880 with tax; the discount is less than a flat 10% of that
        // because the order_percentage_discount action is applied against subTotalWithTax, which
        // also carries the multivendor plugin's negative platform fee surcharge.
        expect(bobs.discounts[0].amountWithTax).toBe(-13897);
        expect(bobs.discounts[0].amount).toBe(-11581);
        // The discount lands on Bob's own lines.
        const bobsLine = bobs.lines[0];
        expect(bobsLine.linePriceWithTax - bobsLine.proratedLinePriceWithTax).toBe(13897);
        // Alice's Channel has no Promotion assigned, so her seller Order must have none.
        expect(alices.discounts).toEqual([]);
    });
});
