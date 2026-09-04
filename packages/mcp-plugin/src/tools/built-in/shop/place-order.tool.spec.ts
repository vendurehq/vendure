import { EntityNotFoundError, Logger, UserInputError } from '@vendure/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaceOrderTool } from './place-order.tool';

/**
 * The tool has to move a cart out of `AddingItems` before Vendure will accept a payment, and it has
 * to stop when the order process refuses that move. Both are checked here with stub services,
 * because a real cart needs a database. The happy path against real data is covered end to end.
 */

const serializer = {
    // Only reached for a Vendure error result now: the tool serializes a successful order itself so
    // that it can tag the answer with a status.
    orderOrError: (result: unknown) => ({ passedThrough: result }),
    order: (order: unknown) => order,
} as any;

/**
 * Stands in for the database connection. The real one opens a transaction and hands the work a
 * context carrying it; this one hands back a marked context so a test can check the tool used it.
 */
function connectionStub() {
    return {
        withTransaction: vi.fn((ctx: any, work: any) =>
            work({ ...ctx, inTransaction: true, translate: (key: string) => key }),
        ),
    } as any;
}

function activeOrderReturning(id: number) {
    // The real service hands back a context in the cart's currency, and the tool has to run its
    // transaction on that one. The stub returns the context it was given so a test can check.
    return {
        findOrThrow: (ctx: unknown) => Promise.resolve({ id, currencyCode: 'USD', ctx }),
    } as any;
}

/** The order the tool re-reads inside its transaction. Most cases only vary the state. */
function orderStub(overrides: { state?: string; customer?: unknown } = {}) {
    return { id: 1, state: 'ArrangingPayment', customer: { id: 5 }, ...overrides };
}

// Both only do anything once an order has been placed, so most cases never reach them.
const customerService = { createAddressesForNewCustomer: vi.fn() } as any;
const sessionService = { unsetActiveOrder: vi.fn() } as any;

function placeOrderTool(activeOrder: any, orderService: any, connection: any = connectionStub()) {
    return new PlaceOrderTool(
        activeOrder,
        orderService,
        serializer,
        connection,
        customerService,
        sessionService,
    );
}

describe('PlaceOrderTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        // One case spies on Logger.error. `clearAllMocks` forgets the recorded calls but leaves the
        // spy in place, so it has to be restored or it outlives its test.
        vi.restoreAllMocks();
    });

    it('answers a refused move on a cart that nobody has claimed with the call that fixes it', async () => {
        // Core's default order process refuses the move for an order with no customer, but only
        // with "Cannot transition". The tool replaces that with the sentence naming the call.
        const refusal = {
            __typename: 'OrderStateTransitionError',
            errorCode: 'ORDER_STATE_TRANSITION_ERROR',
            message: 'Cannot transition Order to the "ArrangingPayment" state',
            transitionError: 'message.cannot-transition-to-payment-without-customer',
        };
        const addPaymentToOrder = vi.fn();
        const orderService = {
            findOne: () => Promise.resolve(orderStub({ state: 'AddingItems', customer: null })),
            transitionToState: () => Promise.resolve(refusal),
            addPaymentToOrder,
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await expect(tool.execute({} as any, { paymentMethodCode: 'standard-payment' })).rejects.toThrow(
            /This cart has no customer yet/,
        );
        expect(addPaymentToOrder).not.toHaveBeenCalled();
    });

    it('takes payment on a customerless cart when the order process allows the move', async () => {
        // `arrangingPaymentRequiresCustomer` defaults to true but a store can switch it off, or
        // replace the order process altogether, so the tool must not refuse on its own account.
        const addPaymentToOrder = vi.fn().mockResolvedValue({ id: 1, state: 'PaymentAuthorized' });
        const orderService = {
            findOne: () => Promise.resolve(orderStub({ state: 'AddingItems', customer: null })),
            transitionToState: vi.fn().mockResolvedValue({ id: 1, state: 'ArrangingPayment' }),
            addPaymentToOrder,
            getOrderPayments: () => Promise.resolve([]),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await tool.execute({} as any, { paymentMethodCode: 'standard-payment' });

        expect(addPaymentToOrder).toHaveBeenCalled();
    });

    it('refuses when the cart vanished between the lookup and the transaction', async () => {
        const orderService = {
            findOne: () => Promise.resolve(undefined),
            transitionToState: vi.fn(),
            addPaymentToOrder: vi.fn(),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await expect(
            tool.execute({} as any, { paymentMethodCode: 'standard-payment' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('refuses without a cart and opens no transaction', async () => {
        const noCart = 'There is no active cart. Add an item with add_to_cart first.';
        const activeOrder = {
            findOrThrow: () => Promise.reject(new UserInputError(noCart)),
        } as any;
        const withTransaction = vi.fn();
        const orderService = {} as any;
        const tool = placeOrderTool(activeOrder, orderService, { withTransaction } as any);

        await expect(
            tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'standard-payment' }),
        ).rejects.toBeInstanceOf(UserInputError);
        expect(withTransaction).not.toHaveBeenCalled();
    });

    it('refuses an anonymous caller with no cart for the missing cart, not for the missing login', async () => {
        // The other cart tools answer "no cart" to this caller. Answering "log in first" here would
        // send a shopper with nothing to pay for through the OAuth flow, and they would then hit the
        // no-cart refusal anyway.
        const activeOrder = {
            findOrThrow: () =>
                Promise.reject(
                    new UserInputError('There is no active cart. Add an item with add_to_cart first.'),
                ),
        } as any;
        const tool = placeOrderTool(activeOrder, {} as any);

        await expect(tool.execute({} as any, { paymentMethodCode: 'standard-payment' })).rejects.toThrow(
            /There is no active cart/,
        );
    });

    it('moves a cart to ArrangingPayment before adding payment', async () => {
        const transitionToState = vi.fn().mockResolvedValue({ id: 1, state: 'ArrangingPayment' });
        const addPaymentToOrder = vi.fn().mockResolvedValue({ id: 1, state: 'PaymentAuthorized' });
        const orderService = {
            findOne: () => Promise.resolve(orderStub({ state: 'AddingItems' })),
            transitionToState,
            addPaymentToOrder,
            getOrderPayments: () => Promise.resolve([]),
        } as any;
        const connection = connectionStub();
        const tool = placeOrderTool(activeOrderReturning(1), orderService, connection);
        const ctx = { activeUserId: 42 } as any;

        await tool.execute(ctx, { paymentMethodCode: 'standard-payment' });

        // The transaction opens on the context the active-order service bound to the cart.
        expect(connection.withTransaction).toHaveBeenCalledWith(ctx, expect.anything());
        expect(transitionToState).toHaveBeenCalledWith(expect.anything(), 1, 'ArrangingPayment');
        expect(addPaymentToOrder).toHaveBeenCalledWith(expect.anything(), 1, {
            method: 'standard-payment',
            metadata: {},
        });
    });

    it('leaves an order that is already at the payment stage alone', async () => {
        const transitionToState = vi.fn();
        const addPaymentToOrder = vi.fn().mockResolvedValue({ id: 1, state: 'PaymentAuthorized' });
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState,
            addPaymentToOrder,
            getOrderPayments: () => Promise.resolve([]),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'standard-payment' });

        expect(transitionToState).not.toHaveBeenCalled();
        expect(addPaymentToOrder).toHaveBeenCalled();
    });

    it('puts the order back in the cart state when the payment fails', async () => {
        const paymentError = {
            __typename: 'IneligiblePaymentMethodError',
            errorCode: 'INELIGIBLE_PAYMENT_METHOD_ERROR',
            message: 'That payment method is not available',
        };
        const transitions: string[] = [];
        const orderService = {
            findOne: () => Promise.resolve(orderStub({ state: 'AddingItems' })),
            transitionToState: (_ctx: unknown, _id: unknown, state: string) => {
                transitions.push(state);
                return Promise.resolve({ id: 1, state });
            },
            addPaymentToOrder: () => Promise.resolve(paymentError),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        const result = await tool.execute({ activeUserId: 42 } as any, {
            paymentMethodCode: 'nonsense',
        });

        // Without the second transition the shopper could never edit their cart again, because
        // changing items or the shipping method requires the AddingItems state.
        expect(transitions).toEqual(['ArrangingPayment', 'AddingItems']);
        expect(result).toEqual({ passedThrough: paymentError });
    });

    it('does not touch the state when the payment fails on an order it did not move', async () => {
        const transitions: string[] = [];
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState: (_ctx: unknown, _id: unknown, state: string) => {
                transitions.push(state);
                return Promise.resolve({ id: 1, state });
            },
            // `errorCode` is what marks a Vendure result as an error, so the stub needs it to send
            // the tool down the failure path.
            addPaymentToOrder: () =>
                Promise.resolve({
                    __typename: 'PaymentFailedError',
                    errorCode: 'PAYMENT_FAILED_ERROR',
                    message: 'no',
                }),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'nonsense' });

        expect(transitions).toEqual([]);
    });

    it("returns the order process's refusal and takes no payment", async () => {
        const refusal = {
            __typename: 'OrderStateTransitionError',
            errorCode: 'ORDER_STATE_TRANSITION_ERROR',
            message: 'Cannot transition Order to the "ArrangingPayment" state',
            transitionError: 'message.cannot-transition-to-payment-without-shipping-method',
        };
        const addPaymentToOrder = vi.fn();
        const orderService = {
            findOne: () => Promise.resolve(orderStub({ state: 'AddingItems', customer: null })),
            transitionToState: () => Promise.resolve(refusal),
            addPaymentToOrder,
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        const result = await tool.execute({ activeUserId: 42 } as any, {
            paymentMethodCode: 'standard-payment',
        });

        expect(result).toEqual({ passedThrough: refusal });
        expect(addPaymentToOrder).not.toHaveBeenCalled();
    });

    it('answers status placed, saves the buyer an address and lets go of the cart', async () => {
        const getOrderPayments = vi.fn().mockResolvedValue([{ id: 9, state: 'Settled' }]);
        const placed = { id: 1, state: 'PaymentSettled', orderPlacedAt: new Date() };
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState: vi.fn(),
            addPaymentToOrder: () => Promise.resolve(placed),
            getOrderPayments,
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);
        const session = { id: 'session-1', activeOrderId: 1 };

        const result = await tool.execute({ activeUserId: 42, session } as any, {
            paymentMethodCode: 'standard-payment',
        });

        expect(result).toMatchObject({ status: 'placed' });
        expect(getOrderPayments).toHaveBeenCalledWith(expect.objectContaining({ inTransaction: true }), 1);
        // The two steps the Shop API's own checkout takes once the order is no longer active.
        expect(customerService.createAddressesForNewCustomer).toHaveBeenCalledWith(
            expect.objectContaining({ inTransaction: true }),
            placed,
        );
        expect(sessionService.unsetActiveOrder).toHaveBeenCalledWith(
            expect.objectContaining({ inTransaction: true }),
            session,
        );
    });

    it('answers status awaiting_payment, keeps the order at the payment stage, and shows the payment', async () => {
        const transitionToState = vi.fn();
        const payment = {
            id: 9,
            state: 'Created',
            metadata: { public: { redirectUrl: 'https://pay.example.com/x' } },
        };
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState,
            addPaymentToOrder: () =>
                Promise.resolve({ id: 1, state: 'ArrangingPayment', orderPlacedAt: null }),
            getOrderPayments: () => Promise.resolve([payment]),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        const result = (await tool.execute(
            { activeUserId: 42, session: { id: 's', activeOrderId: 1 } } as any,
            {
                paymentMethodCode: 'redirect-payment',
            },
        )) as any;

        expect(result.status).toBe('awaiting_payment');
        expect(result.message).toContain('the order is not placed yet');
        expect(result.message).toContain('The cart cannot be edited while the order is in ArrangingPayment.');
        expect(result.order.payments).toEqual([payment]);
        // A pending payment has to stay attached to this order so the provider can settle it later,
        // which a move back to the cart state would break.
        expect(transitionToState).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'AddingItems',
        );
        expect(customerService.createAddressesForNewCustomer).not.toHaveBeenCalled();
        expect(sessionService.unsetActiveOrder).not.toHaveBeenCalled();
    });

    it('drops the cart-editing sentence when the unplaced order is not in ArrangingPayment', async () => {
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState: vi.fn(),
            addPaymentToOrder: () => Promise.resolve({ id: 1, state: 'PaymentSettled', orderPlacedAt: null }),
            getOrderPayments: () => Promise.resolve([]),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        const result = (await tool.execute({ activeUserId: 42 } as any, {
            paymentMethodCode: 'standard-payment',
        })) as any;

        expect(result.status).toBe('awaiting_payment');
        expect(result.message).not.toContain('ArrangingPayment');
    });

    it('passes on a payment-method refusal unchanged, so the caller can retry with a valid code', async () => {
        // `addPaymentToOrder` itself refuses an unknown, disabled or wrong-channel method code.
        // That refusal is caller-safe and a corrected code is exactly what should be retried, so
        // the tool must not swap it for the payment-provider warning.
        const refusal = new UserInputError('error.payment-method-not-found', { method: 'nope' });
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState: vi.fn(),
            addPaymentToOrder: () => Promise.reject(refusal),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await expect(tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'nope' })).rejects.toBe(
            refusal,
        );
    });

    it('tells the caller a payment may have been taken when the payment handler throws', async () => {
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState: vi.fn(),
            addPaymentToOrder: () => Promise.reject(new Error('gateway timeout')),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        const rejection = tool.execute({ activeUserId: 42 } as any, {
            paymentMethodCode: 'standard-payment',
        });

        await expect(rejection).rejects.toBeInstanceOf(UserInputError);
        await expect(rejection).rejects.toThrowError(
            'The payment provider could not be reached or refused the request. Do not retry ' +
                'automatically. Call get_cart to check whether a payment was recorded, and tell the user.',
        );
        // The provider's own words stay server-side, but an operator still needs them.
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining('gateway timeout'),
            expect.anything(),
            expect.anything(),
        );
    });

    it('takes the payment inside a transaction', async () => {
        // `OrderService.addPaymentToOrder` throws unless the context it is given carries an open
        // transaction, and a tool call does not go through a resolver, so nothing else opens one.
        const addPaymentToOrder = vi.fn().mockResolvedValue({ id: 1, state: 'PaymentAuthorized' });
        const orderService = {
            findOne: () => Promise.resolve(orderStub()),
            transitionToState: vi.fn(),
            addPaymentToOrder,
            getOrderPayments: () => Promise.resolve([]),
        } as any;
        const tool = placeOrderTool(activeOrderReturning(1), orderService);

        await tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'standard-payment' });

        expect(addPaymentToOrder).toHaveBeenCalledWith(expect.objectContaining({ inTransaction: true }), 1, {
            method: 'standard-payment',
            metadata: {},
        });
    });
});
