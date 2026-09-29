/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    CurrencyCode,
    DeletionResult,
    HistoryEntryType,
    LanguageCode,
    Permission,
} from '@vendure/common/lib/generated-types';
import { manualFulfillmentHandler, mergeConfig, PaymentMethodHandler } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    channelFragment,
    fulfillmentFragment,
    paymentFragment,
    refundFragment,
} from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import {
    addNoteToCustomerDocument,
    addNoteToOrderDocument,
    assignProductToChannelDocument,
    cancelPaymentDocument,
    createAdministratorDocument,
    createChannelDocument,
    createFulfillmentDocument,
    createRoleDocument,
    deleteCustomerNoteDocument,
    deleteOrderNoteDocument,
    getCustomerHistoryDocument,
    getCustomerListDocument,
    getOrderDocument,
    getOrderHistoryDocument,
    refundOrderDocument,
    settlePaymentDocument,
    settleRefundDocument,
    transitFulfillmentDocument,
    transitionPaymentToStateDocument,
    updateCustomerNoteDocument,
    updateOrderNoteDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

const getPaymentMethodIdsDocument = graphql(`
    query GetPaymentMethodIds {
        paymentMethods {
            items {
                id
            }
        }
    }
`);

const getShippingMethodIdsDocument = graphql(`
    query GetShippingMethodIds {
        shippingMethods {
            items {
                id
            }
        }
    }
`);

const assignPaymentMethodsToChannelDocument = graphql(`
    mutation AssignPaymentMethodsToChannel($input: AssignPaymentMethodsToChannelInput!) {
        assignPaymentMethodsToChannel(input: $input) {
            id
        }
    }
`);

const assignShippingMethodsToChannelDocument = graphql(`
    mutation AssignShippingMethodsToChannel($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
        }
    }
`);

const settlePaymentSpy = vi.fn();
const cancelPaymentSpy = vi.fn();
const createRefundSpy = vi.fn();

/**
 * A two-stage (authorize, capture) payment method. Each gateway call records a spy so the tests
 * can prove a cross-channel mutation never reaches the payment gateway.
 */
const spiedPaymentMethod = new PaymentMethodHandler({
    code: 'channel-scope-payment-method',
    description: [{ languageCode: LanguageCode.en, value: 'Channel scope test payment method' }],
    args: {},
    createPayment: (ctx, order, amount, args, metadata) => ({
        amount,
        state: 'Authorized',
        transactionId: '12345-' + order.code,
        metadata: { public: metadata },
    }),
    settlePayment: (...args) => {
        settlePaymentSpy(...args);
        return { success: true };
    },
    cancelPayment: (...args) => {
        cancelPaymentSpy(...args);
        return { success: true };
    },
    createRefund: (...args) => {
        createRefundSpy(...args);
        return { state: 'Settled' };
    },
});

/**
 * Payment, Refund, Fulfillment and OrderHistoryEntry are not ChannelAware, so the only channel
 * boundary they have is their parent Order. These tests check that the Admin API mutations which
 * take one of those child ids cannot be used by a Channel-scoped administrator to read or mutate
 * another Channel's data.
 *
 * CustomerHistoryEntry has the same shape, with the Customer as its only channel boundary, so the
 * customer note mutations are covered here too.
 *
 * Covers GHSA-7qvr-c5vf-xxfh, GHSA-vqq3-xv95-pmf6 and the Payment/Refund items of
 * GHSA-7xv4-2q6r-84w3.
 */
describe('Order child entity channel scoping', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [spiedPaymentMethod],
            },
        }),
    );

    const SECOND_CHANNEL_TOKEN = 'second_channel_token';
    const channelBAdmin = { emailAddress: 'channel-b-admin@test.com', password: 'test-password' };

    type ChannelFragment = FragmentOf<typeof channelFragment>;
    type PaymentFragment = FragmentOf<typeof paymentFragment>;
    type RefundFragment = FragmentOf<typeof refundFragment>;
    type FulfillmentFragment = FragmentOf<typeof fulfillmentFragment>;

    const channelGuard: ErrorResultGuard<ChannelFragment> = createErrorResultGuard(input => !!input.token);
    const paymentGuard: ErrorResultGuard<PaymentFragment> = createErrorResultGuard(input => !!input.state);
    const refundGuard: ErrorResultGuard<RefundFragment> = createErrorResultGuard(input => !!input.state);
    const fulfillmentGuard: ErrorResultGuard<FulfillmentFragment> = createErrorResultGuard(
        input => !!input.state,
    );

    // Channel A is the default channel.
    let orderAId: string;
    let orderALineId: string;
    let paymentAId: string;
    let refundAId: string;
    let fulfillmentAId: string;
    let noteAId: string;
    let stateTransitionEntryAId: string;
    // A second Channel A order whose Payment is left in the Authorized state.
    let orderA2Id: string;
    let paymentA2Id: string;
    // Channel B fixtures.
    let orderBId: string;
    let paymentBId: string;
    // The second seeded customer only ever orders in Channel A, so Channel B never sees it.
    let customerAId: string;
    let customerNoteAId: string;
    let customerRegisteredEntryAId: string;
    // The first seeded customer has ordered in Channel B, so it is assigned to both Channels.
    let customerBId: string;

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: spiedPaymentMethod.code,
                        handler: { code: spiedPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();

        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'channel-b',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        channelGuard.assertSuccess(createChannel);
        const channelBId = createChannel.id;

        await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: channelBId, productIds: ['T_1'], priceFactor: 1 },
        });
        const { paymentMethods } = await adminClient.query(getPaymentMethodIdsDocument);
        await adminClient.query(assignPaymentMethodsToChannelDocument, {
            input: { channelId: channelBId, paymentMethodIds: paymentMethods.items.map(m => m.id) },
        });
        const { shippingMethods } = await adminClient.query(getShippingMethodIdsDocument);
        await adminClient.query(assignShippingMethodsToChannelDocument, {
            input: { channelId: channelBId, shippingMethodIds: shippingMethods.items.map(m => m.id) },
        });

        // An administrator whose only role is scoped to Channel B.
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'channel-b-orders',
                description: 'Manage orders in Channel B',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.ReadCustomer,
                    Permission.UpdateCustomer,
                    Permission.ReadOrder,
                    Permission.UpdateOrder,
                ],
                channelIds: [channelBId],
            },
        });
        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: channelBAdmin.emailAddress,
                firstName: 'Bob',
                lastName: 'ChannelB',
                password: channelBAdmin.password,
                roleIds: [createRole.id],
            },
        });

        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 2 } });

        // Channel A order: settled payment, one fulfillment, one settled refund and one note.
        await shopClient.asUserWithCredentials(customers.items[0].emailAddress, 'test');
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        await proceedToArrangingPayment(shopClient);
        const orderA = await addPaymentToOrder(shopClient, spiedPaymentMethod);
        orderAId = orderA.id;
        paymentAId = orderA.payments![0].id;

        const { settlePayment } = await adminClient.query(settlePaymentDocument, { id: paymentAId });
        paymentGuard.assertSuccess(settlePayment);

        const { order: orderAWithLines } = await adminClient.query(getOrderDocument, { id: orderAId });
        orderALineId = orderAWithLines!.lines[0].id;

        const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
            input: {
                lines: [{ orderLineId: orderALineId, quantity: 1 }],
                handler: {
                    code: manualFulfillmentHandler.code,
                    arguments: [{ name: 'method', value: 'Test' }],
                },
            },
        });
        fulfillmentGuard.assertSuccess(addFulfillmentToOrder);
        fulfillmentAId = addFulfillmentToOrder.id;

        const { refundOrder } = await adminClient.query(refundOrderDocument, {
            input: {
                lines: [{ orderLineId: orderALineId, quantity: 1 }],
                shipping: 0,
                adjustment: 0,
                paymentId: paymentAId,
            },
        });
        refundGuard.assertSuccess(refundOrder);
        refundAId = refundOrder.id;

        await adminClient.query(addNoteToOrderDocument, {
            input: { id: orderAId, note: 'Channel A note', isPublic: false },
        });
        const { order: orderAWithHistory } = await adminClient.query(getOrderHistoryDocument, {
            id: orderAId,
        });
        noteAId = orderAWithHistory!.history.items.find(i => i.type === HistoryEntryType.ORDER_NOTE)!.id;
        stateTransitionEntryAId = orderAWithHistory!.history.items.find(
            i => i.type === HistoryEntryType.ORDER_STATE_TRANSITION,
        )!.id;

        // A second Channel A order, left with an Authorized payment.
        await shopClient.asUserWithCredentials(customers.items[1].emailAddress, 'test');
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_2', quantity: 1 });
        await proceedToArrangingPayment(shopClient);
        const orderA2 = await addPaymentToOrder(shopClient, spiedPaymentMethod);
        orderA2Id = orderA2.id;
        paymentA2Id = orderA2.payments![0].id;

        // Channel B order, also left with an Authorized payment.
        await shopClient.asUserWithCredentials(customers.items[0].emailAddress, 'test');
        shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await proceedToArrangingPayment(shopClient);
        const orderB = await addPaymentToOrder(shopClient, spiedPaymentMethod);
        orderBId = orderB.id;
        paymentBId = orderB.payments![0].id;

        // Channel A customer note on the customer who never left Channel A.
        customerAId = customers.items[1].id;
        customerBId = customers.items[0].id;
        await adminClient.query(addNoteToCustomerDocument, {
            input: { id: customerAId, note: 'Channel A customer note', isPublic: false },
        });
        const { customer: customerAWithHistory } = await adminClient.query(getCustomerHistoryDocument, {
            id: customerAId,
        });
        customerNoteAId = customerAWithHistory!.history.items.find(
            i => i.type === HistoryEntryType.CUSTOMER_NOTE,
        )!.id;
        customerRegisteredEntryAId = customerAWithHistory!.history.items.find(
            i => i.type === HistoryEntryType.CUSTOMER_REGISTERED,
        )!.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('a Channel B administrator cannot act on Channel A order children', () => {
        beforeAll(async () => {
            await adminClient.asUserWithCredentials(channelBAdmin.emailAddress, channelBAdmin.password);
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            settlePaymentSpy.mockClear();
            cancelPaymentSpy.mockClear();
            createRefundSpy.mockClear();
        });

        it('cannot read the Channel A order at all', async () => {
            const { order } = await adminClient.query(getOrderDocument, { id: orderAId });
            expect(order).toBeNull();
        });

        it('settlePayment', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(settlePaymentDocument, { id: paymentA2Id });
            }, 'No Payment with the id')();
            expect(settlePaymentSpy).not.toHaveBeenCalled();
        });

        it('cancelPayment', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(cancelPaymentDocument, { paymentId: paymentA2Id });
            }, 'No Payment with the id')();
            expect(cancelPaymentSpy).not.toHaveBeenCalled();
        });

        it('transitionPaymentToState to Cancelled', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(transitionPaymentToStateDocument, {
                    id: paymentA2Id,
                    state: 'Cancelled',
                });
            }, 'No Payment with the id')();
            expect(cancelPaymentSpy).not.toHaveBeenCalled();
        });

        // 'Settled' and 'Cancelled' are delegated to settlePayment/cancelPayment. Any other state
        // takes the fallthrough branch of PaymentService.transitionToState, which is a separate
        // Payment lookup.
        it(
            'transitionPaymentToState to Error',
            assertThrowsWithMessage(async () => {
                await adminClient.query(transitionPaymentToStateDocument, {
                    id: paymentA2Id,
                    state: 'Error',
                });
            }, 'No Payment with the id'),
        );

        // GHSA-7qvr-c5vf-xxfh: with an empty `lines` array the PaymentOrderMismatchError guard is
        // skipped, so the Payment lookup was the only thing standing between the caller and a real
        // refund against another Channel's payment gateway.
        it('refundOrder with an empty lines array', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(refundOrderDocument, {
                    input: {
                        lines: [],
                        shipping: 100,
                        adjustment: 0,
                        paymentId: paymentAId,
                    },
                });
            }, 'No Payment with the id')();
            expect(createRefundSpy).not.toHaveBeenCalled();
        });

        it('refundOrder with Channel A order lines', async () => {
            await assertThrowsWithMessage(async () => {
                await adminClient.query(refundOrderDocument, {
                    input: {
                        lines: [{ orderLineId: orderALineId, quantity: 1 }],
                        shipping: 0,
                        adjustment: 0,
                        paymentId: paymentAId,
                    },
                });
            }, 'No OrderLine with the id')();
            expect(createRefundSpy).not.toHaveBeenCalled();
        });

        it(
            'settleRefund',
            assertThrowsWithMessage(async () => {
                await adminClient.query(settleRefundDocument, {
                    input: { id: refundAId, transactionId: 'not-mine' },
                });
            }, 'No Refund with the id'),
        );

        it(
            'transitionFulfillmentToState',
            assertThrowsWithMessage(async () => {
                await adminClient.query(transitFulfillmentDocument, {
                    id: fulfillmentAId,
                    state: 'Shipped',
                });
            }, 'No Fulfillment with the id'),
        );

        it(
            'addFulfillmentToOrder with Channel A order lines',
            assertThrowsWithMessage(async () => {
                await adminClient.query(createFulfillmentDocument, {
                    input: {
                        lines: [{ orderLineId: orderALineId, quantity: 1 }],
                        handler: {
                            code: manualFulfillmentHandler.code,
                            arguments: [{ name: 'method', value: 'Other channel' }],
                        },
                    },
                });
            }, 'No OrderLine with the id'),
        );

        it(
            'updateOrderNote',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateOrderNoteDocument, {
                    input: { noteId: noteAId, note: 'changed by another channel' },
                });
            }, 'No OrderHistoryEntry with the id'),
        );

        it('deleteOrderNote', async () => {
            const { deleteOrderNote } = await adminClient.query(deleteOrderNoteDocument, { id: noteAId });
            expect(deleteOrderNote.result).toBe(DeletionResult.NOT_DELETED);
        });

        it('leaves the Channel A order state untouched', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { order } = await adminClient.query(getOrderDocument, { id: orderAId });
            expect(order!.payments!.find(p => p.id === paymentAId)!.state).toBe('Settled');
            expect(order!.payments!.find(p => p.id === paymentAId)!.refunds.length).toBe(1);
            expect(order!.fulfillments!.find(f => f.id === fulfillmentAId)!.state).toBe('Pending');

            const { order: orderWithHistory } = await adminClient.query(getOrderHistoryDocument, {
                id: orderAId,
            });
            const note = orderWithHistory!.history.items.find(i => i.id === noteAId);
            expect(note).toBeDefined();
            expect((note!.data as { note: string }).note).toBe('Channel A note');

            const { order: orderA2 } = await adminClient.query(getOrderDocument, { id: orderA2Id });
            expect(orderA2!.payments!.find(p => p.id === paymentA2Id)!.state).toBe('Authorized');
        });
    });

    describe('a Channel B administrator cannot act on Channel A customer notes', () => {
        beforeAll(async () => {
            await adminClient.asUserWithCredentials(channelBAdmin.emailAddress, channelBAdmin.password);
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        });

        it('cannot read the Channel A customer at all', async () => {
            const { customer } = await adminClient.query(getCustomerHistoryDocument, { id: customerAId });
            expect(customer).toBeNull();
        });

        it(
            'updateCustomerNote',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateCustomerNoteDocument, {
                    input: { noteId: customerNoteAId, note: 'changed by another channel' },
                });
            }, 'No CustomerHistoryEntry with the id'),
        );

        it('deleteCustomerNote', async () => {
            const { deleteCustomerNote } = await adminClient.query(deleteCustomerNoteDocument, {
                id: customerNoteAId,
            });
            expect(deleteCustomerNote.result).toBe(DeletionResult.NOT_DELETED);
        });

        it('leaves the Channel A customer note untouched', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { customer } = await adminClient.query(getCustomerHistoryDocument, { id: customerAId });
            const note = customer!.history.items.find(i => i.id === customerNoteAId);
            expect(note).toBeDefined();
            expect((note!.data as { note: string }).note).toBe('Channel A customer note');
        });
    });

    describe('positive controls', () => {
        beforeAll(() => {
            settlePaymentSpy.mockClear();
            cancelPaymentSpy.mockClear();
            createRefundSpy.mockClear();
        });

        it('the Channel B administrator can settle a payment on a Channel B order', async () => {
            await adminClient.asUserWithCredentials(channelBAdmin.emailAddress, channelBAdmin.password);
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

            const { settlePayment } = await adminClient.query(settlePaymentDocument, { id: paymentBId });
            paymentGuard.assertSuccess(settlePayment);
            expect(settlePayment.state).toBe('Settled');
            expect(settlePaymentSpy).toHaveBeenCalledTimes(1);
        });

        it('the Channel B administrator can add, update and delete a note on a Channel B order', async () => {
            await adminClient.query(addNoteToOrderDocument, {
                input: { id: orderBId, note: 'Channel B note', isPublic: false },
            });
            const { order } = await adminClient.query(getOrderHistoryDocument, { id: orderBId });
            const noteBId = order!.history.items.find(i => i.type === HistoryEntryType.ORDER_NOTE)!.id;

            const { updateOrderNote } = await adminClient.query(updateOrderNoteDocument, {
                input: { noteId: noteBId, note: 'Channel B note updated' },
            });
            expect((updateOrderNote.data as { note: string }).note).toBe('Channel B note updated');

            const { deleteOrderNote } = await adminClient.query(deleteOrderNoteDocument, { id: noteBId });
            expect(deleteOrderNote.result).toBe(DeletionResult.DELETED);
        });

        it('the SuperAdmin in the default channel can still refund the Channel A order', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { refundOrder } = await adminClient.query(refundOrderDocument, {
                input: {
                    lines: [{ orderLineId: orderALineId, quantity: 1 }],
                    shipping: 0,
                    adjustment: 0,
                    paymentId: paymentAId,
                },
            });
            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.state).toBe('Settled');
            expect(createRefundSpy).toHaveBeenCalledTimes(1);
        });

        it('the SuperAdmin in the default channel can still transition the Channel A fulfillment', async () => {
            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: fulfillmentAId,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);
            expect(transitionFulfillmentToState.state).toBe('Shipped');
        });

        it('the SuperAdmin in the default channel can still cancel the Channel A payment', async () => {
            const { cancelPayment } = await adminClient.query(cancelPaymentDocument, {
                paymentId: paymentA2Id,
            });
            paymentGuard.assertSuccess(cancelPayment);
            expect(cancelPayment.state).toBe('Cancelled');
            expect(cancelPaymentSpy).toHaveBeenCalledTimes(1);
        });

        // GHSA-vqq3-xv95-pmf6: deleteOrderNote must not be usable to delete arbitrary
        // OrderHistoryEntry rows.
        it('deleteOrderNote does not delete a history entry which is not an ORDER_NOTE', async () => {
            const { deleteOrderNote } = await adminClient.query(deleteOrderNoteDocument, {
                id: stateTransitionEntryAId,
            });
            expect(deleteOrderNote.result).toBe(DeletionResult.NOT_DELETED);

            const { order } = await adminClient.query(getOrderHistoryDocument, { id: orderAId });
            expect(order!.history.items.find(i => i.id === stateTransitionEntryAId)).toBeDefined();
        });

        it('deleteCustomerNote does not delete a history entry which is not a CUSTOMER_NOTE', async () => {
            const { deleteCustomerNote } = await adminClient.query(deleteCustomerNoteDocument, {
                id: customerRegisteredEntryAId,
            });
            expect(deleteCustomerNote.result).toBe(DeletionResult.NOT_DELETED);

            const { customer } = await adminClient.query(getCustomerHistoryDocument, { id: customerAId });
            expect(customer!.history.items.find(i => i.id === customerRegisteredEntryAId)).toBeDefined();
        });

        it('the Channel B administrator can add, update and delete a note on a Channel B customer', async () => {
            await adminClient.asUserWithCredentials(channelBAdmin.emailAddress, channelBAdmin.password);
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

            await adminClient.query(addNoteToCustomerDocument, {
                input: { id: customerBId, note: 'Channel B customer note', isPublic: false },
            });
            const { customer } = await adminClient.query(getCustomerHistoryDocument, { id: customerBId });
            const noteBId = customer!.history.items.find(i => i.type === HistoryEntryType.CUSTOMER_NOTE)!.id;

            const { updateCustomerNote } = await adminClient.query(updateCustomerNoteDocument, {
                input: { noteId: noteBId, note: 'Channel B customer note updated' },
            });
            expect((updateCustomerNote.data as { note: string }).note).toBe(
                'Channel B customer note updated',
            );

            const { deleteCustomerNote } = await adminClient.query(deleteCustomerNoteDocument, {
                id: noteBId,
            });
            expect(deleteCustomerNote.result).toBe(DeletionResult.DELETED);
        });
    });
});
