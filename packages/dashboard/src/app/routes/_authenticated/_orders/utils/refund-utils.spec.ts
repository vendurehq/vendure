import { describe, expect, it } from 'vitest';

import {
    allocateRefundTotal,
    mergeRefundTargets,
    reconcileRefundTargets,
    RefundTarget,
} from './refund-utils.js';

// OSS-857 — the refund targets are rebuilt when the refundDestinations query resolves or the order's
// payments change. A rebuild must keep the allocation the administrator has entered.

function target(overrides: Partial<RefundTarget> & { id: string }): RefundTarget {
    return {
        label: overrides.id,
        type: 'payment',
        paymentId: 'P1',
        eligiblePaymentIds: ['P1'],
        amountToRefund: 0,
        selected: false,
        ...overrides,
    };
}

describe('mergeRefundTargets', () => {
    it('returns the rebuilt targets with their defaults when the current list is empty', () => {
        const rebuilt = [target({ id: 'payment-P1', selected: true })];

        expect(mergeRefundTargets([], rebuilt)).toBe(rebuilt);
    });

    it('returns the rebuilt targets with their defaults when no rebuilt target is in the current list', () => {
        const current = [target({ id: 'payment-P1', amountToRefund: 300, selected: true })];
        const rebuilt = [
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: true }),
            target({ id: 'dest-credit', type: 'destination', paymentId: 'P2', eligiblePaymentIds: ['P2'] }),
        ];

        expect(mergeRefundTargets(current, rebuilt)).toBe(rebuilt);
    });

    it('keeps the selection, amount, arguments and payment of a target in both lists', () => {
        const current = [
            target({ id: 'payment-P1', selected: false }),
            target({
                id: 'dest-credit',
                type: 'destination',
                paymentId: 'P2',
                eligiblePaymentIds: ['P1', 'P2'],
                amountToRefund: 500,
                selected: true,
                args: { note: 'abc' },
            }),
        ];
        const rebuilt = [
            target({ id: 'payment-P1', selected: true }),
            target({
                id: 'dest-credit',
                label: 'Store credit',
                type: 'destination',
                paymentId: 'P1',
                eligiblePaymentIds: ['P1', 'P2'],
            }),
        ];

        expect(mergeRefundTargets(current, rebuilt)).toEqual([
            target({ id: 'payment-P1', selected: false }),
            target({
                id: 'dest-credit',
                label: 'Store credit',
                type: 'destination',
                paymentId: 'P2',
                eligiblePaymentIds: ['P1', 'P2'],
                amountToRefund: 500,
                selected: true,
                args: { note: 'abc' },
            }),
        ]);
    });

    it('takes the rebuilt payment when the kept payment is no longer eligible', () => {
        const current = [
            target({
                id: 'dest-credit',
                type: 'destination',
                paymentId: 'P2',
                eligiblePaymentIds: ['P1', 'P2'],
                amountToRefund: 500,
                selected: true,
            }),
        ];
        const rebuilt = [
            target({ id: 'dest-credit', type: 'destination', paymentId: 'P1', eligiblePaymentIds: ['P1'] }),
        ];

        const [merged] = mergeRefundTargets(current, rebuilt);

        expect(merged.paymentId).toBe('P1');
        expect(merged.eligiblePaymentIds).toEqual(['P1']);
        expect(merged.amountToRefund).toBe(500);
        expect(merged.selected).toBe(true);
    });

    it('drops a target which is missing from the rebuilt list', () => {
        const current = [
            target({ id: 'payment-P1', amountToRefund: 300, selected: true }),
            target({ id: 'dest-credit', type: 'destination', amountToRefund: 200, selected: true }),
        ];
        const rebuilt = [target({ id: 'payment-P1' })];

        expect(mergeRefundTargets(current, rebuilt).map(t => t.id)).toEqual(['payment-P1']);
    });

    it('adds a target which is new in the rebuilt list unselected with a zero amount', () => {
        const current = [target({ id: 'payment-P1', amountToRefund: 300, selected: true })];
        const rebuilt = [
            target({ id: 'payment-P1' }),
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: true }),
        ];

        const merged = mergeRefundTargets(current, rebuilt);

        expect(merged[0]).toMatchObject({ id: 'payment-P1', amountToRefund: 300, selected: true });
        expect(merged[1]).toMatchObject({ id: 'payment-P2', amountToRefund: 0, selected: false });
    });
});

describe('allocateRefundTotal', () => {
    it('allocates to payments before destinations, capped at each payment balance', () => {
        const targets = [
            target({ id: 'dest-credit', type: 'destination', selected: true }),
            target({ id: 'payment-P1', selected: true }),
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: true }),
        ];

        const allocated = allocateRefundTotal(targets, 1000, { P1: 300, P2: 500 });

        expect(allocated.map(t => [t.id, t.amountToRefund])).toEqual([
            ['dest-credit', 0],
            ['payment-P1', 300],
            ['payment-P2', 500],
        ]);
    });
});

describe('reconcileRefundTargets', () => {
    it('allocates the refund total when no rebuilt target is in the current list', () => {
        const current = [target({ id: 'payment-P1', amountToRefund: 1000, selected: true })];
        const rebuilt = [
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: true }),
        ];

        const reconciled = reconcileRefundTargets(current, rebuilt, 1000, { P2: 1500 });

        expect(reconciled).toEqual([
            target({
                id: 'payment-P2',
                paymentId: 'P2',
                eligiblePaymentIds: ['P2'],
                amountToRefund: 1000,
                selected: true,
            }),
        ]);
    });

    it('allocates the refund total when a selected target with an amount is dropped', () => {
        const current = [
            target({ id: 'payment-P1', amountToRefund: 400, selected: true }),
            target({ id: 'dest-credit', type: 'destination', amountToRefund: 600, selected: true }),
        ];
        const rebuilt = [target({ id: 'payment-P1' })];

        const reconciled = reconcileRefundTargets(current, rebuilt, 1000, { P1: 1500 });

        expect(reconciled.map(t => [t.id, t.amountToRefund])).toEqual([['payment-P1', 1000]]);
    });

    it('uses the default selection when the dropped target was the only one selected', () => {
        const current = [
            target({ id: 'payment-P1', amountToRefund: 1000, selected: true }),
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: false }),
        ];
        const rebuilt = [
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: true }),
        ];

        const reconciled = reconcileRefundTargets(current, rebuilt, 1000, { P2: 1500 });

        expect(reconciled.map(t => [t.id, t.selected, t.amountToRefund])).toEqual([
            ['payment-P2', true, 1000],
        ]);
    });

    it('allocates the refund total when a payment balance falls below the amount drawn from it', () => {
        const current = [
            target({ id: 'payment-P1', amountToRefund: 1000, selected: true }),
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'], selected: true }),
        ];
        const rebuilt = [
            target({ id: 'payment-P1' }),
            target({ id: 'payment-P2', paymentId: 'P2', eligiblePaymentIds: ['P2'] }),
        ];

        const reconciled = reconcileRefundTargets(current, rebuilt, 1000, { P1: 800, P2: 500 });

        expect(reconciled.map(t => [t.id, t.amountToRefund])).toEqual([
            ['payment-P1', 800],
            ['payment-P2', 200],
        ]);
    });

    it('keeps typed amounts which still fit within the payment balances', () => {
        const current = [
            target({ id: 'payment-P1', amountToRefund: 600, selected: true }),
            target({ id: 'dest-credit', type: 'destination', amountToRefund: 400, selected: true }),
        ];
        const rebuilt = [target({ id: 'payment-P1' }), target({ id: 'dest-credit', type: 'destination' })];

        const reconciled = reconcileRefundTargets(current, rebuilt, 1000, { P1: 1000 });

        expect(reconciled.map(t => [t.id, t.amountToRefund])).toEqual([
            ['payment-P1', 600],
            ['dest-credit', 400],
        ]);
    });
});
