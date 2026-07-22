import { describe, expect, it } from 'vitest';

import { Order } from '../../entity/order/order.entity';

import { TtlOrderRecalculationStrategy } from './ttl-order-recalculation-strategy';

describe('TtlOrderRecalculationStrategy', () => {
    const ctx = {} as any;
    const strategy = new TtlOrderRecalculationStrategy({ ttlMs: 60_000 });

    function orderWith(pricingUpdatedAt: Date | undefined): Order {
        return { pricingUpdatedAt } as Order;
    }

    it('is stale when pricingUpdatedAt is null/undefined', () => {
        expect(strategy.shouldRecalculate(ctx, orderWith(undefined))).toBe(true);
    });

    it('is not stale within the TTL window', () => {
        expect(strategy.shouldRecalculate(ctx, orderWith(new Date(Date.now() - 1_000)))).toBe(false);
    });

    it('is stale past the TTL window', () => {
        expect(strategy.shouldRecalculate(ctx, orderWith(new Date(Date.now() - 120_000)))).toBe(true);
    });

    it('is stale at exactly the TTL boundary (>= comparison)', () => {
        // At exactly Date.now() - ttlMs the order is considered stale (>= comparison).
        expect(strategy.shouldRecalculate(ctx, orderWith(new Date(Date.now() - 60_000)))).toBe(true);
    });
});
