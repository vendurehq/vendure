import { describe, expect, it, vi } from 'vitest';

import { ListMyOrdersTool } from './list-my-orders.tool';

const serializer = { order: (order: unknown) => order } as any;

describe('ListMyOrdersTool', () => {
    // The tool has no sort argument, so the default order is the only order a caller ever gets. It
    // has to be newest first: an agent asked "what did I just order?" reads the first page, and the
    // customer's most recent order has to be on it. Open carts have no orderPlacedAt, so the sort
    // is on createdAt with id breaking ties.
    it('lists the newest orders first', async () => {
        const findByCustomerId = vi.fn().mockResolvedValue({ items: [], totalItems: 0 });
        const customerService = { findOneByUserId: () => Promise.resolve({ id: 7 }) } as any;
        const translator = { translate: (entity: unknown) => entity } as any;
        const tool = new ListMyOrdersTool(
            customerService,
            { findByCustomerId } as any,
            translator,
            serializer,
        );

        await tool.execute({ activeUserId: 42 } as any, { limit: 5 });

        expect(findByCustomerId).toHaveBeenCalledWith(
            expect.anything(),
            7,
            expect.objectContaining({ take: 5, sort: { createdAt: 'DESC', id: 'DESC' } }),
            expect.anything(),
        );
    });
});
