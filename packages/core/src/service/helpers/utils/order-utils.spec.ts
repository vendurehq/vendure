import { describe, expect, it } from 'vitest';

import { Order } from '../../../entity/order/order.entity';
import { Payment } from '../../../entity/payment/payment.entity';
import { Refund } from '../../../entity/refund/refund.entity';

import { totalCoveredByPayments } from './order-utils';

describe('totalCoveredByPayments()', () => {
    it('single payment, any state, no refunds', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                }),
            ],
        });

        expect(totalCoveredByPayments(order)).toBe(500);
    });

    it('multiple payments, any state, no refunds', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                }),
                new Payment({
                    state: 'Settled',
                    amount: 300,
                }),
            ],
        });

        expect(totalCoveredByPayments(order)).toBe(800);
    });

    it('multiple payments, any state, error and declined', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Error',
                    amount: 500,
                }),
                new Payment({
                    state: 'Declined',
                    amount: 300,
                }),
            ],
        });

        expect(totalCoveredByPayments(order)).toBe(0);
    });

    it('multiple payments, single state', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                }),
                new Payment({
                    state: 'Authorized',
                    amount: 300,
                }),
            ],
        });

        expect(totalCoveredByPayments(order, 'Settled')).toBe(500);
    });

    it('multiple payments, multiple states', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                }),
                new Payment({
                    state: 'Authorized',
                    amount: 300,
                }),
            ],
        });

        expect(totalCoveredByPayments(order, ['Settled', 'Authorized'])).toBe(800);
    });

    it('single payment, refunds with different states', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                    refunds: [
                        new Refund({ state: 'Settled', total: 100 }),
                        new Refund({ state: 'Pending', total: 200 }),
                    ],
                }),
            ],
        });

        expect(totalCoveredByPayments(order, ['Settled', 'Authorized'])).toBe(400);
    });

    it('single payment, refunds with different states', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                    refunds: [
                        new Refund({ state: 'Settled', total: 100 }),
                        new Refund({ state: 'Pending', total: 200 }),
                    ],
                }),
            ],
        });

        expect(totalCoveredByPayments(order, ['Settled', 'Authorized'])).toBe(400);
    });

    it('multiple payments, refunds with different states', () => {
        const order = new Order({
            payments: [
                new Payment({
                    state: 'Settled',
                    amount: 500,
                    refunds: [
                        new Refund({ state: 'Settled', total: 100 }),
                        new Refund({ state: 'Pending', total: 200 }),
                        new Refund({ state: 'Settled', total: 100 }),
                    ],
                }),
                new Payment({
                    state: 'Settled',
                    amount: 500,
                    refunds: [
                        new Refund({ state: 'Settled', total: 100 }),
                        new Refund({ state: 'Failed', total: 200 }),
                        new Refund({ state: 'Pending', total: 200 }),
                    ],
                }),
            ],
        });

        expect(totalCoveredByPayments(order, ['Settled', 'Authorized'])).toBe(700);
    });
});
