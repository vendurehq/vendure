import { describe, expect, it, vi } from 'vitest';

import { CreateFulfillmentTool } from './create-fulfillment.tool';

/**
 * Covers the two paths a real database cannot reach.
 *
 * A refused state transition is one of them: on core's default fulfillment process a brand new
 * fulfillment sits in `Pending`, and both `Shipped` and `Delivered` are legal moves out of it, so
 * nothing an e2e test can set up makes core say no. The tool still has to undo the fulfillment it
 * created, which is what these stubs check.
 */

const serializer = {
    fulfillment: (fulfillment: unknown, lines: unknown) => ({ fulfillment, lines }),
    order: (order: unknown) => order,
} as any;

/**
 * Stands in for the database connection. The real one rolls its transaction back when the work
 * throws, so this records whether it did.
 */
function connectionStub() {
    const threw = vi.fn();
    return {
        threw,
        connection: {
            withTransaction: async (ctx: any, work: any) => {
                try {
                    return await work(ctx);
                } catch (e) {
                    threw(e);
                    throw e;
                }
            },
        } as any,
    };
}

const ORDER = {
    id: 1,
    lines: [{ id: 10, quantity: 2 }],
    fulfillments: [],
};

const REFUSAL = {
    __typename: 'FulfillmentStateTransitionError',
    errorCode: 'FULFILLMENT_STATE_TRANSITION_ERROR',
    message: 'Cannot transition Fulfillment from Pending to Shipped',
};

function orderServiceStub(overrides: Record<string, unknown> = {}) {
    return {
        findOne: () => Promise.resolve(ORDER),
        createFulfillment: vi.fn(() => Promise.resolve({ id: 99, state: 'Pending' })),
        transitionFulfillmentToState: vi.fn(() => Promise.resolve({ id: 99, state: 'Shipped' })),
        ...overrides,
    } as any;
}

function tool(orderService: any, connection: any) {
    return new CreateFulfillmentTool(orderService, serializer, connection);
}

describe('CreateFulfillmentTool', () => {
    it('rolls the whole call back and returns the error result when core refuses the transition', async () => {
        const orderService = orderServiceStub({
            transitionFulfillmentToState: vi.fn(() => Promise.resolve(REFUSAL)),
        });
        const { threw, connection } = connectionStub();

        const result = await tool(orderService, connection).execute({} as any, {
            orderId: 1,
            method: 'Test Carrier',
            state: 'Shipped',
        });

        expect(result).toBe(REFUSAL);
        // Throwing is what undoes the fulfillment created a moment earlier.
        expect(threw).toHaveBeenCalledOnce();
    });

    it('lets an unrelated failure out rather than reporting it as a refused transition', async () => {
        const boom = new Error('connection lost');
        const orderService = orderServiceStub({
            createFulfillment: vi.fn(() => Promise.reject(boom)),
        });
        const { connection } = connectionStub();

        await expect(
            tool(orderService, connection).execute({} as any, { orderId: 1, method: 'Test Carrier' }),
        ).rejects.toBe(boom);
    });
});
