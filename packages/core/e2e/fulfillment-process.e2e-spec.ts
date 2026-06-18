/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode } from '@vendure/common/lib/generated-types';
import {
    CustomFulfillmentProcess,
    defaultFulfillmentProcess,
    manualFulfillmentHandler,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { fulfillmentFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    createFulfillmentDocument,
    getCustomerListDocument,
    getOrderFulfillmentsDocument,
    transitFulfillmentDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

const initSpy = vi.fn();
const transitionStartSpy = vi.fn();
const transitionEndSpy = vi.fn();
const transitionEndSpy2 = vi.fn();
const transitionErrorSpy = vi.fn();

describe('Fulfillment process', () => {
    type FulfillmentFragment = FragmentOf<typeof fulfillmentFragment>;
    const fulfillmentGuard: ErrorResultGuard<FulfillmentFragment> = createErrorResultGuard(
        input => !!input.id,
    );
    const VALIDATION_ERROR_MESSAGE = 'Fulfillment must have a tracking code';
    const customOrderProcess: CustomFulfillmentProcess<'AwaitingPickup'> = {
        init(injector) {
            initSpy(injector.get(TransactionalConnection).rawConnection.name);
        },
        transitions: {
            Pending: {
                to: ['AwaitingPickup'],
                mergeStrategy: 'replace',
            },
            AwaitingPickup: {
                to: ['Shipped'],
            },
        },
        onTransitionStart(fromState, toState, data) {
            transitionStartSpy(fromState, toState, data);
            if (fromState === 'AwaitingPickup' && toState === 'Shipped') {
                if (!data.fulfillment.trackingCode) {
                    return VALIDATION_ERROR_MESSAGE;
                }
            }
        },
        onTransitionEnd(fromState, toState, data) {
            transitionEndSpy(fromState, toState, data);
        },
        onTransitionError(fromState, toState, message) {
            transitionErrorSpy(fromState, toState, message);
        },
    };

    const customOrderProcess2: CustomFulfillmentProcess<'AwaitingPickup'> = {
        transitions: {
            AwaitingPickup: {
                to: ['Cancelled'],
            },
        },
        onTransitionEnd(fromState, toState, data) {
            transitionEndSpy2(fromState, toState, data);
        },
    };

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            shippingOptions: {
                ...testConfig().shippingOptions,
                process: [defaultFulfillmentProcess, customOrderProcess as any, customOrderProcess2 as any],
            },
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
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

        // Create a couple of orders to be queried
        const result = await adminClient.query(getCustomerListDocument, {
            options: {
                take: 3,
            },
        });
        const customers = result.customers.items;

        /**
         * Creates a Orders to test Fulfillment Process
         */
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        // Add Items
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        // Transit to payment
        await proceedToArrangingPayment(shopClient);
        await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);

        // Add a fulfillment without tracking code
        await adminClient.query(createFulfillmentDocument, {
            input: {
                lines: [{ orderLineId: 'T_1', quantity: 1 }],
                handler: {
                    code: manualFulfillmentHandler.code,
                    arguments: [{ name: 'method', value: 'Test1' }],
                },
            },
        });

        // Add a fulfillment with tracking code
        await adminClient.query(createFulfillmentDocument, {
            input: {
                lines: [{ orderLineId: 'T_2', quantity: 1 }],
                handler: {
                    code: manualFulfillmentHandler.code,
                    arguments: [
                        { name: 'method', value: 'Test1' },
                        { name: 'trackingCode', value: '222' },
                    ],
                },
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('CustomFulfillmentProcess', () => {
        it('is injectable', () => {
            expect(initSpy).toHaveBeenCalled();
            expect(initSpy.mock.calls[0][0]).toBe('default');
        });

        it('replaced transition target', async () => {
            const { order } = await adminClient.query(getOrderFulfillmentsDocument, {
                id: 'T_1',
            });
            const [fulfillment] = order?.fulfillments || [];
            expect(fulfillment.nextStates).toEqual(['AwaitingPickup']);
        });

        it('custom onTransitionStart handler returning error message', async () => {
            // First transit to AwaitingPickup
            await adminClient.query(transitFulfillmentDocument, {
                id: 'T_1',
                state: 'AwaitingPickup',
            });

            transitionStartSpy.mockClear();
            transitionErrorSpy.mockClear();
            transitionEndSpy.mockClear();

            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: 'T_1',
                state: 'Shipped',
            });

            fulfillmentGuard.assertErrorResult(transitionFulfillmentToState);
            expect(transitionFulfillmentToState.errorCode).toBe(ErrorCode.FULFILLMENT_STATE_TRANSITION_ERROR);
            expect(transitionFulfillmentToState.transitionError).toBe(VALIDATION_ERROR_MESSAGE);

            expect(transitionStartSpy).toHaveBeenCalledTimes(1);
            expect(transitionErrorSpy).toHaveBeenCalledTimes(1);
            expect(transitionEndSpy).not.toHaveBeenCalled();
            expect(transitionErrorSpy.mock.calls[0]).toEqual([
                'AwaitingPickup',
                'Shipped',
                VALIDATION_ERROR_MESSAGE,
            ]);
        });

        it('custom onTransitionStart handler allows transition', async () => {
            transitionEndSpy.mockClear();

            // First transit to AwaitingPickup
            await adminClient.query(transitFulfillmentDocument, {
                id: 'T_2',
                state: 'AwaitingPickup',
            });

            transitionEndSpy.mockClear();

            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: 'T_2',
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionEndSpy).toHaveBeenCalledTimes(1);
            expect(transitionEndSpy.mock.calls[0].slice(0, 2)).toEqual(['AwaitingPickup', 'Shipped']);
            expect(transitionFulfillmentToState?.state).toBe('Shipped');
        });

        it('composes multiple CustomFulfillmentProcesses', async () => {
            const { order } = await adminClient.query(getOrderFulfillmentsDocument, {
                id: 'T_1',
            });
            const [fulfillment] = order?.fulfillments || [];
            expect(fulfillment.nextStates).toEqual(['Shipped', 'Cancelled']);
        });
    });
});
