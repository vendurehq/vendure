import { describe, expect, it, vi } from 'vitest';

import { PlaceOrderTool } from './place-order.tool';

/**
 * The tool has to move a cart out of `AddingItems` before Vendure will accept a payment, and it has
 * to stop when the order process refuses that move. Both are checked here with stub services,
 * because a real cart needs a database. The happy path against real data is covered end to end.
 */

const serializer = {
    orderOrError: (result: unknown) => ({ passedThrough: result }),
} as any;

/**
 * Stands in for the database connection. The real one opens a transaction and hands the work a
 * context carrying it; this one hands back a marked context so a test can check the tool used it.
 */
function connectionStub() {
    return {
        withTransaction: (ctx: any, work: any) => work({ ...ctx, inTransaction: true }),
    } as any;
}

function activeOrderReturning(id: number) {
    return { findOrCreate: () => Promise.resolve({ id, currencyCode: 'USD' }) } as any;
}

describe('PlaceOrderTool', () => {
    it('refuses without an authorized customer, and touches no order', async () => {
        const orderService = new Proxy(
            {},
            {
                get() {
                    throw new Error('place_order reached the order instead of refusing');
                },
            },
        ) as any;
        const tool = new PlaceOrderTool(orderService, orderService, serializer, connectionStub());

        const result = await tool.execute({} as any, { paymentMethodCode: 'standard-payment' });

        expect(result).toMatchObject({ requiresAuthorization: true });
    });

    it('moves a cart to ArrangingPayment before adding payment', async () => {
        const transitionToState = vi.fn().mockResolvedValue({ id: 1, state: 'ArrangingPayment' });
        const addPaymentToOrder = vi.fn().mockResolvedValue({ id: 1, state: 'PaymentAuthorized' });
        const orderService = {
            findOne: () => Promise.resolve({ id: 1, state: 'AddingItems' }),
            transitionToState,
            addPaymentToOrder,
        } as any;
        const tool = new PlaceOrderTool(activeOrderReturning(1), orderService, serializer, connectionStub());

        await tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'standard-payment' });

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
            findOne: () => Promise.resolve({ id: 1, state: 'ArrangingPayment' }),
            transitionToState,
            addPaymentToOrder,
        } as any;
        const tool = new PlaceOrderTool(activeOrderReturning(1), orderService, serializer, connectionStub());

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
            findOne: () => Promise.resolve({ id: 1, state: 'AddingItems' }),
            transitionToState: (_ctx: unknown, _id: unknown, state: string) => {
                transitions.push(state);
                return Promise.resolve({ id: 1, state });
            },
            addPaymentToOrder: () => Promise.resolve(paymentError),
        } as any;
        const tool = new PlaceOrderTool(activeOrderReturning(1), orderService, serializer, connectionStub());

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
            findOne: () => Promise.resolve({ id: 1, state: 'ArrangingPayment' }),
            transitionToState: (_ctx: unknown, _id: unknown, state: string) => {
                transitions.push(state);
                return Promise.resolve({ id: 1, state });
            },
            addPaymentToOrder: () => Promise.resolve({ __typename: 'PaymentFailedError', message: 'no' }),
        } as any;
        const tool = new PlaceOrderTool(activeOrderReturning(1), orderService, serializer, connectionStub());

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
            findOne: () => Promise.resolve({ id: 1, state: 'AddingItems' }),
            transitionToState: () => Promise.resolve(refusal),
            addPaymentToOrder,
        } as any;
        const tool = new PlaceOrderTool(activeOrderReturning(1), orderService, serializer, connectionStub());

        const result = await tool.execute({ activeUserId: 42 } as any, {
            paymentMethodCode: 'standard-payment',
        });

        expect(result).toEqual({ passedThrough: refusal });
        expect(addPaymentToOrder).not.toHaveBeenCalled();
    });

    it('takes the payment inside a transaction', async () => {
        // `OrderService.addPaymentToOrder` throws unless the context it is given carries an open
        // transaction, and a tool call does not go through a resolver, so nothing else opens one.
        const addPaymentToOrder = vi.fn().mockResolvedValue({ id: 1, state: 'PaymentAuthorized' });
        const orderService = {
            findOne: () => Promise.resolve({ id: 1, state: 'ArrangingPayment' }),
            transitionToState: vi.fn(),
            addPaymentToOrder,
        } as any;
        const tool = new PlaceOrderTool(activeOrderReturning(1), orderService, serializer, connectionStub());

        await tool.execute({ activeUserId: 42 } as any, { paymentMethodCode: 'standard-payment' });

        expect(addPaymentToOrder).toHaveBeenCalledWith(expect.objectContaining({ inTransaction: true }), 1, {
            method: 'standard-payment',
            metadata: {},
        });
    });
});
