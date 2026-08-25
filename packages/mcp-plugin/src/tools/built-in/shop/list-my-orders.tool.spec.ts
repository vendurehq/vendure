import { describe, expect, it, vi } from 'vitest';

import { ListMyOrdersTool } from './list-my-orders.tool';

const serializer = { order: (order: unknown) => order } as any;

describe('ListMyOrdersTool', () => {
    // The tool has no sort argument, so the default order is the only order a caller ever gets. It
    // has to be newest first: an agent asked "what did I just order?" reads the first page, and the
    // customer's most recent order has to be on it.
    it('lists the newest placed orders first', async () => {
        const findByCustomerId = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        const customerService = { findOneByUserId: () => Promise.resolve({ id: 7 }) } as any;
        const tool = new ListMyOrdersTool(customerService, { findByCustomerId } as any, serializer);

        await tool.execute({ activeUserId: 42 } as any, { limit: 5 });

        expect(findByCustomerId).toHaveBeenCalledWith(
            expect.anything(),
            7,
            expect.objectContaining({ take: 5, sort: { orderPlacedAt: 'DESC' } }),
            expect.anything(),
        );
    });
});
