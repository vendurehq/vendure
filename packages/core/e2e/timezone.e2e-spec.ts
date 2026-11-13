/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * OSS-1007 / #1719 / #3409: timestamps must be correct instants through every layer,
 * whatever the Node process TZ and the DB server/session timezone are.
 *
 * Run it under a non-UTC process timezone to see the Postgres discrepancies, e.g.
 * `TZ=Europe/Vienna DB=postgres bunx vitest --config vitest.e2e.config.mts timezone`
 */
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

// Vienna fall-back: 02:30 local happens twice. These are the two different instants.
const DST_FIRST = '2026-10-25T00:30:00.000Z';
const DST_SECOND = '2026-10-25T01:30:00.000Z';
// Los Angeles fall-back.
const LA_SECOND = '2026-11-01T09:30:00.000Z';
const MINUTE = 60_000;

const CREATE_PROMOTION = gql`
    mutation CreatePromotion($input: CreatePromotionInput!) {
        createPromotion(input: $input) {
            ... on ErrorResult { errorCode message }
            ... on Promotion {
                id
                createdAt
                startsAt
                endsAt
                customFields {
                    validFrom
                }
            }
        }
    }
`;
const GET_PROMOTIONS = gql`
    query GetPromotions($options: PromotionListOptions) {
        promotions(options: $options) {
            items {
                id
                createdAt
                startsAt
                endsAt
                customFields {
                    validFrom
                }
            }
            totalItems
        }
    }
`;
const GET_ORDER = gql`
    query GetOrderDates($id: ID!) {
        order(id: $id) {
            id
            createdAt
            updatedAt
            orderPlacedAt
        }
    }
`;
const GET_ORDERS = gql`
    query GetOrders($options: OrderListOptions) {
        orders(options: $options) {
            items {
                id
                orderPlacedAt
            }
            totalItems
        }
    }
`;

describe('Timezone handling (OSS-1007)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: { paymentMethodHandlers: [testSuccessfulPaymentMethod] },
            // OSS1007_TS_TYPE=timestamp runs the pre-v4 column type on Postgres
            entityOptions: {
                timestampColumnType: (process.env.OSS1007_TS_TYPE as 'timestamp' | undefined) ?? 'timestamptz',
            },
            customFields: {
                Promotion: [{ name: 'validFrom', type: 'datetime', nullable: true }],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [{ name: testSuccessfulPaymentMethod.code, handler: { code: testSuccessfulPaymentMethod.code, arguments: [] } }],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let promotionIds: string[] = [];
    let before: number;
    let after: number;

    it('createdAt is the real instant of creation', async () => {
        before = Date.now();
        const { createPromotion } = await adminClient.query(CREATE_PROMOTION, {
            input: {
                enabled: true,
                startsAt: DST_FIRST,
                endsAt: DST_SECOND,
                couponCode: 'TZ-' + Date.now(),
                conditions: [],
                actions: [{ code: 'order_percentage_discount', arguments: [{ name: 'discount', value: '10' }] }],
                translations: [{ languageCode: 'en', name: 'tz-1' }],
                customFields: { validFrom: LA_SECOND },
            },
        });
        after = Date.now();
        if (!createPromotion.id) throw new Error(JSON.stringify(createPromotion));
        promotionIds.push(createPromotion.id);
        const createdAt = new Date(createPromotion.createdAt).getTime();
        expect(createdAt).toBeGreaterThanOrEqual(before - MINUTE);
        expect(createdAt).toBeLessThanOrEqual(after + MINUTE);
    });

    it('DateTime inputs round-trip as the same instant, also across DST fall-back', async () => {
        const { promotions } = await adminClient.query(GET_PROMOTIONS, {
            options: { filter: { id: { eq: promotionIds[0] } } },
        });
        const p = promotions.items[0];
        expect(p.startsAt).toBe(DST_FIRST);
        expect(p.endsAt).toBe(DST_SECOND);
        expect(p.customFields.validFrom).toBe(LA_SECOND);
    });

    it('a DateTime list filter finds the entity by its createdAt', async () => {
        const { promotions } = await adminClient.query(GET_PROMOTIONS, {
            options: {
                filter: {
                    id: { eq: promotionIds[0] },
                    createdAt: { between: { start: new Date(before - MINUTE).toISOString(), end: new Date(after + MINUTE).toISOString() } },
                },
            },
        });
        expect(promotions.totalItems).toBe(1);
    });

    it('a DateTime list filter on an explicit Date column finds the entity', async () => {
        const { promotions } = await adminClient.query(GET_PROMOTIONS, {
            options: {
                filter: {
                    id: { eq: promotionIds[0] },
                    endsAt: { between: { start: new Date(Date.parse(DST_SECOND) - MINUTE).toISOString(), end: new Date(Date.parse(DST_SECOND) + MINUTE).toISOString() } },
                },
            },
        });
        expect(promotions.totalItems).toBe(1);
    });

    let orderId: string;
    it('order createdAt, updatedAt and orderPlacedAt agree', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        before = Date.now();
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await proceedToArrangingPayment(shopClient);
        const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        after = Date.now();
        orderId = order.id;
        const { order: o } = await adminClient.query(GET_ORDER, { id: orderId });
        for (const field of ['createdAt', 'updatedAt', 'orderPlacedAt'] as const) {
            const t = new Date(o[field]).getTime();
            expect(t, `${field}=${o[field as string]} window ${new Date(before).toISOString()}..${new Date(after).toISOString()}`).toBeGreaterThanOrEqual(before - MINUTE);
            expect(t, `${field}=${o[field as string]}`).toBeLessThanOrEqual(after + MINUTE);
        }
    });

    it('orders filtered by orderPlacedAt "after" an instant just before placing include the order', async () => {
        const { orders } = await adminClient.query(GET_ORDERS, {
            options: { filter: { id: { eq: orderId }, orderPlacedAt: { after: new Date(before - MINUTE).toISOString() } } },
        });
        expect(orders.totalItems).toBe(1);
    });
});
