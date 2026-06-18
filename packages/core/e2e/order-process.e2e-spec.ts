/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode, HistoryEntryType } from '@vendure/common/lib/generated-types';
import {
    CustomOrderProcess,
    defaultOrderProcess,
    HistoryService,
    mergeConfig,
    Order,
    OrderService,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { orderFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import { FragmentOf as FragmentOfShop } from './graphql/graphql-shop';
import { adminTransitionToStateDocument, getOrderDocument } from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    addPaymentDocument,
    getNextStatesDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderFragment,
    transitionToStateDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';

const initSpy = vi.fn();
const transitionStartSpy = vi.fn();
const transitionEndSpy = vi.fn();
const transitionEndSpy2 = vi.fn();
const transitionErrorSpy = vi.fn();

describe('Order process', () => {
    const VALIDATION_ERROR_MESSAGE = 'Customer must have a company email address';
    const customOrderProcess: CustomOrderProcess<'ValidatingCustomer' | 'PaymentProcessing'> = {
        init(injector) {
            initSpy(injector.get(TransactionalConnection).rawConnection.name);
        },
        transitions: {
            AddingItems: {
                to: ['ValidatingCustomer'],
                mergeStrategy: 'replace',
            },
            ValidatingCustomer: {
                to: ['ArrangingPayment', 'AddingItems'],
            },
            ArrangingPayment: {
                to: ['PaymentProcessing'],
            },
            PaymentProcessing: {
                to: ['PaymentAuthorized', 'PaymentSettled'],
            },
        },
        onTransitionStart(fromState, toState, data) {
            transitionStartSpy(fromState, toState, data);
            if (toState === 'ValidatingCustomer') {
                if (!data.order.customer) {
                    return false;
                }
                if (!data.order.customer.emailAddress.includes('@company.com')) {
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

    const customOrderProcess2: CustomOrderProcess<'ValidatingCustomer'> = {
        transitions: {
            ValidatingCustomer: {
                to: ['Cancelled'],
            },
        },
        onTransitionEnd(fromState, toState, data) {
            transitionEndSpy2(fromState, toState, data);
        },
    };

    // #4686 — toggleable failure used by the rollback test below. Defaults to
    // null so the existing tests in this suite are unaffected; the rollback
    // test enables it for the duration of its run.
    let failOnTransitionEndForState: string | null = null;
    const ROLLBACK_FAILURE_MESSAGE = 'simulated onTransitionEnd failure';
    const failingOrderProcess: CustomOrderProcess<never> = {
        transitions: {},
        onTransitionEnd(fromState, toState) {
            if (failOnTransitionEndForState === toState) {
                throw new Error(ROLLBACK_FAILURE_MESSAGE);
            }
        },
    };

    // Create guards for different fragment types
    type TestOrderFragmentType = FragmentOfShop<typeof testOrderFragment>;
    type UpdatedOrderFragmentType = FragmentOfShop<typeof updatedOrderFragment>;
    type AdminOrderFragmentType = FragmentOf<typeof orderFragment>;

    const testOrderGuard: ErrorResultGuard<TestOrderFragmentType> = createErrorResultGuard(
        input => !!input.lines,
    );

    const updatedOrderGuard: ErrorResultGuard<UpdatedOrderFragmentType> = createErrorResultGuard(
        input => !!input.lines,
    );

    const adminOrderGuard: ErrorResultGuard<AdminOrderFragmentType> = createErrorResultGuard(
        input => !!input.id,
    );

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                process: [
                    defaultOrderProcess,
                    customOrderProcess,
                    customOrderProcess2,
                    failingOrderProcess,
                ] as any,
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('Initial transition', () => {
        it('transitions from Created to AddingItems on creation', async () => {
            transitionStartSpy.mockClear();
            transitionEndSpy.mockClear();
            await shopClient.asAnonymousUser();

            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            expect(transitionStartSpy).toHaveBeenCalledTimes(1);
            expect(transitionEndSpy).toHaveBeenCalledTimes(1);
            expect(transitionStartSpy.mock.calls[0].slice(0, 2)).toEqual(['Created', 'AddingItems']);
            expect(transitionEndSpy.mock.calls[0].slice(0, 2)).toEqual(['Created', 'AddingItems']);
        });
    });

    describe('CustomOrderProcess', () => {
        it('CustomOrderProcess is injectable', () => {
            expect(initSpy).toHaveBeenCalled();
            expect(initSpy.mock.calls[0][0]).toBe('default');
        });

        it('replaced transition target', async () => {
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            const { nextOrderStates } = await shopClient.query(getNextStatesDocument);

            expect(nextOrderStates).toEqual(['ValidatingCustomer']);
        });

        it('custom onTransitionStart handler returning false', async () => {
            transitionStartSpy.mockClear();
            transitionEndSpy.mockClear();

            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ValidatingCustomer',
            });
            testOrderGuard.assertSuccess(transitionOrderToState!);

            expect(transitionStartSpy).toHaveBeenCalledTimes(1);
            expect(transitionEndSpy).not.toHaveBeenCalled();
            expect(transitionStartSpy.mock.calls[0].slice(0, 2)).toEqual([
                'AddingItems',
                'ValidatingCustomer',
            ]);
            expect(transitionOrderToState.state).toBe('AddingItems');
        });

        it('custom onTransitionStart handler returning error message', async () => {
            transitionStartSpy.mockClear();
            transitionErrorSpy.mockClear();

            await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Joe',
                    lastName: 'Test',
                    emailAddress: 'joetest@gmail.com',
                },
            });

            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ValidatingCustomer',
            });
            testOrderGuard.assertErrorResult(transitionOrderToState!);

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "AddingItems" to "ValidatingCustomer"',
            );
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
            expect(transitionOrderToState.transitionError).toBe(VALIDATION_ERROR_MESSAGE);
            expect(transitionOrderToState.fromState).toBe('AddingItems');
            expect(transitionOrderToState.toState).toBe('ValidatingCustomer');

            expect(transitionStartSpy).toHaveBeenCalledTimes(1);
            expect(transitionErrorSpy).toHaveBeenCalledTimes(1);
            expect(transitionEndSpy).not.toHaveBeenCalled();
            expect(transitionErrorSpy.mock.calls[0]).toEqual([
                'AddingItems',
                'ValidatingCustomer',
                VALIDATION_ERROR_MESSAGE,
            ]);
        });

        it('custom onTransitionStart handler allows transition', async () => {
            transitionEndSpy.mockClear();

            await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Joe',
                    lastName: 'Test',
                    emailAddress: 'joetest@company.com',
                },
            });

            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ValidatingCustomer',
            });
            testOrderGuard.assertSuccess(transitionOrderToState!);

            expect(transitionEndSpy).toHaveBeenCalledTimes(1);
            expect(transitionEndSpy.mock.calls[0].slice(0, 2)).toEqual(['AddingItems', 'ValidatingCustomer']);
            expect(transitionOrderToState.state).toBe('ValidatingCustomer');
        });

        it('composes multiple CustomOrderProcesses', async () => {
            transitionEndSpy.mockClear();
            transitionEndSpy2.mockClear();

            const { nextOrderStates } = await shopClient.query(getNextStatesDocument);

            expect(nextOrderStates).toEqual(['ArrangingPayment', 'AddingItems', 'Cancelled']);

            await shopClient.query(transitionToStateDocument, {
                state: 'AddingItems',
            });

            expect(transitionEndSpy.mock.calls[0].slice(0, 2)).toEqual(['ValidatingCustomer', 'AddingItems']);
            expect(transitionEndSpy2.mock.calls[0].slice(0, 2)).toEqual([
                'ValidatingCustomer',
                'AddingItems',
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/963
        it('allows addPaymentToOrder from a custom state', async () => {
            await shopClient.query(setShippingMethodDocument, { id: ['T_1'] });
            const result0 = await shopClient.query(transitionToStateDocument, {
                state: 'ValidatingCustomer',
            });
            testOrderGuard.assertSuccess(result0.transitionOrderToState!);
            const result1 = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            testOrderGuard.assertSuccess(result1.transitionOrderToState!);
            const result2 = await shopClient.query(transitionToStateDocument, {
                state: 'PaymentProcessing',
            });
            testOrderGuard.assertSuccess(result2.transitionOrderToState!);
            expect(result2.transitionOrderToState.state).toBe('PaymentProcessing');
            const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                },
            });
            updatedOrderGuard.assertSuccess(addPaymentToOrder);
            expect(addPaymentToOrder.state).toBe('PaymentSettled');
        });
    });

    describe('Admin API transition constraints', () => {
        let order: FragmentOfShop<typeof testOrderFragment>;

        beforeAll(async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Su',
                    lastName: 'Test',
                    emailAddress: 'sutest@company.com',
                },
            });
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    fullName: 'name',
                    streetLine1: '12 the street',
                    city: 'foo',
                    postalCode: '123456',
                    countryCode: 'US',
                    phoneNumber: '4444444',
                },
            });
            await shopClient.query(setShippingMethodDocument, { id: ['T_1'] });
            await shopClient.query(transitionToStateDocument, {
                state: 'ValidatingCustomer',
            });
            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            testOrderGuard.assertSuccess(transitionOrderToState!);

            order = transitionOrderToState as TestOrderFragmentType;
        });

        it('cannot manually transition to PaymentAuthorized', async () => {
            expect(order.state).toBe('ArrangingPayment');

            const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                id: order.id,
                state: 'PaymentAuthorized',
            });
            adminOrderGuard.assertErrorResult(transitionOrderToState!);

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "ArrangingPayment" to "PaymentAuthorized"',
            );
            expect(transitionOrderToState.transitionError).toBe(
                'Cannot transition Order to the "PaymentAuthorized" state when the total is not covered by authorized Payments',
            );

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(result.order?.state).toBe('ArrangingPayment');
        });

        it('cannot manually transition to PaymentSettled', async () => {
            const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                id: order.id,
                state: 'PaymentSettled',
            });
            adminOrderGuard.assertErrorResult(transitionOrderToState!);

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "ArrangingPayment" to "PaymentSettled"',
            );
            expect(transitionOrderToState.transitionError).toContain(
                'Cannot transition Order to the "PaymentSettled" state when the total is not covered by settled Payments',
            );

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(result.order?.state).toBe('ArrangingPayment');
        });

        it('cannot manually transition to Cancelled', async () => {
            const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                },
            });
            updatedOrderGuard.assertSuccess(addPaymentToOrder);

            expect(addPaymentToOrder?.state).toBe('PaymentSettled');

            const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                id: order.id,
                state: 'Cancelled',
            });
            adminOrderGuard.assertErrorResult(transitionOrderToState!);

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "PaymentSettled" to "Cancelled"',
            );
            expect(transitionOrderToState.transitionError).toContain(
                'Cannot transition Order to the "Cancelled" state unless all OrderItems are cancelled',
            );

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(result.order?.state).toBe('PaymentSettled');
        });

        it('cannot manually transition to PartiallyDelivered', async () => {
            const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                id: order.id,
                state: 'PartiallyDelivered',
            });
            adminOrderGuard.assertErrorResult(transitionOrderToState!);

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "PaymentSettled" to "PartiallyDelivered"',
            );
            expect(transitionOrderToState.transitionError).toContain(
                'Cannot transition Order to the "PartiallyDelivered" state unless some OrderItems are delivered',
            );

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(result.order?.state).toBe('PaymentSettled');
        });

        it('cannot manually transition to Delivered', async () => {
            const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                id: order.id,
                state: 'Delivered',
            });
            adminOrderGuard.assertErrorResult(transitionOrderToState!);

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "PaymentSettled" to "Delivered"',
            );
            expect(transitionOrderToState.transitionError).toContain(
                'Cannot transition Order to the "Delivered" state unless all OrderItems are delivered',
            );

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(result.order?.state).toBe('PaymentSettled');
        });
    });

    // #4686 — When OrderService.transitionToState is called from a context
    // without an outer @Transaction() (worker job, scheduled task, plugin
    // mutation, event-bus subscriber) and an onTransitionEnd hook throws, the
    // order must be rolled back atomically. Without the withTransaction wrap
    // inside transitionToState, save 1 commits the new state, finalize() throws,
    // save 2 never runs, and the order is left in a corrupted half-committed
    // state.
    describe('onTransitionEnd rollback (#4686)', () => {
        afterAll(() => {
            failOnTransitionEndForState = null;
        });

        it('rolls back atomically when called from a non-transactional context', async () => {
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            testOrderGuard.assertSuccess(addItemToOrder);
            // Customer email must include `@company.com` so the existing
            // customOrderProcess.onTransitionStart guard for ValidatingCustomer
            // passes — otherwise the transition is rejected by the state
            // machine before onTransitionEnd ever runs and the test couldn't
            // exercise the rollback path.
            await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Rollback',
                    lastName: 'Test',
                    emailAddress: 'rollback@company.com',
                },
            });

            // GraphQL IDs are prefixed (e.g. "T_1") via the configured
            // EntityIdStrategy; strip the prefix to get the raw DB id used
            // by services and TypeORM.
            const orderId = +String(addItemToOrder.id).replace(/^\D+/g, '');
            const orderService = server.app.get(OrderService);
            const historyService = server.app.get(HistoryService);
            const ctxBuilder = server.app.get(RequestContextService);
            const connection = server.app.get(TransactionalConnection);

            const orderBefore = await connection.rawConnection
                .getRepository(Order)
                .findOneOrFail({ where: { id: orderId } });
            expect(orderBefore.state).toBe('AddingItems');
            expect(orderBefore.active).toBe(true);
            expect(orderBefore.orderPlacedAt).toBeNull();

            // A fresh, non-transactional ctx — equivalent to a worker job or
            // plugin mutation that omits @Transaction().
            const ctx = await ctxBuilder.create({ apiType: 'admin' });

            // ValidatingCustomer is the only target reachable from AddingItems
            // under the customOrderProcess merge ('replace' strategy collapses
            // the default targets to just this one).
            failOnTransitionEndForState = 'ValidatingCustomer';

            let thrown: Error | undefined;
            try {
                await orderService.transitionToState(ctx, orderId, 'ValidatingCustomer');
            } catch (e) {
                thrown = e as Error;
            }
            expect(thrown).toBeDefined();
            expect(thrown!.message).toContain(ROLLBACK_FAILURE_MESSAGE);

            // Re-read from the database. Assert literal values so the
            // post-condition checks cannot go vacuously true if the
            // pre-condition silently breaks.
            const orderAfter = await connection.rawConnection
                .getRepository(Order)
                .findOneOrFail({ where: { id: orderId } });

            expect(orderAfter.state).toBe('AddingItems');
            expect(orderAfter.active).toBe(true);
            expect(orderAfter.orderPlacedAt).toBeNull();

            // No ORDER_STATE_TRANSITION history entry should exist for the
            // failed transition.
            const history = await historyService.getHistoryForOrder(ctx, orderId, false);
            const failedTransitionEntry = history.items.find(
                entry =>
                    entry.type === HistoryEntryType.ORDER_STATE_TRANSITION &&
                    (entry.data as any)?.to === 'ValidatingCustomer',
            );
            expect(failedTransitionEntry).toBeUndefined();
        });
    });
});
