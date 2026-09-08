import { ID } from '@vendure/common/lib/shared-types';
import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { EntityNotFoundError } from '../../../common/error/errors';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Order } from '../../../entity/order/order.entity';
import { Payment } from '../../../entity/payment/payment.entity';
import { Refund } from '../../../entity/refund/refund.entity';

import { assertOrderIsInChannel, totalCoveredByPayments } from './order-utils';

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

const DEFAULT_CHANNEL_ID = 1;
const CHANNEL_A_ID = 2;
const CHANNEL_B_ID = 3;

function contextForChannel(channelId: ID): RequestContext {
    return { channelId } as RequestContext;
}

/**
 * Stands in for the TransactionalConnection. `exists` is what the existence query resolves to, and
 * `params` records the values bound into the query, so a test can assert that the Order id and the
 * active Channel id both reached the SQL.
 */
function connectionReturning(exists: boolean) {
    const params: Record<string, any> = {};
    const qb = {
        innerJoin: () => qb,
        where: (_: string, p: Record<string, any>) => (Object.assign(params, p), qb),
        andWhere: (_: string, p: Record<string, any>) => (Object.assign(params, p), qb),
        getExists: () => Promise.resolve(exists),
    };
    const connection = {
        getRepository: () => ({ createQueryBuilder: () => qb }),
    } as unknown as TransactionalConnection;
    return { connection, params };
}

describe('assertOrderIsInChannel()', () => {
    it('resolves when the Order is in the active Channel', async () => {
        const { connection } = connectionReturning(true);
        await expect(
            assertOrderIsInChannel(contextForChannel(CHANNEL_A_ID), connection, 10, 'Payment', 7),
        ).resolves.toBeUndefined();
    });

    it('throws when the Order is not in the active Channel', async () => {
        const { connection } = connectionReturning(false);
        await expect(
            assertOrderIsInChannel(contextForChannel(CHANNEL_B_ID), connection, 10, 'Payment', 7),
        ).rejects.toBeInstanceOf(EntityNotFoundError);
    });

    it('names the child entity and id, not the Order, so it cannot be used to probe for Orders', async () => {
        const { connection } = connectionReturning(false);
        let error: any;
        try {
            await assertOrderIsInChannel(contextForChannel(CHANNEL_B_ID), connection, 10, 'Payment', 7);
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(EntityNotFoundError);
        expect(error.variables).toEqual({ entityName: 'Payment', id: 7 });
    });

    it('constrains the query by both the Order id and the active Channel id', async () => {
        const { connection, params } = connectionReturning(true);
        await assertOrderIsInChannel(
            contextForChannel(DEFAULT_CHANNEL_ID),
            connection,
            10,
            'Fulfillment',
            5,
        );
        expect(params).toEqual({ orderId: 10, channelId: DEFAULT_CHANNEL_ID });
    });

    it('carries the child entity name through to the error for every child type', async () => {
        const { connection } = connectionReturning(false);
        for (const entityName of ['Payment', 'Refund', 'Fulfillment', 'OrderHistoryEntry']) {
            let error: any;
            try {
                await assertOrderIsInChannel(
                    contextForChannel(CHANNEL_A_ID),
                    connection,
                    10,
                    entityName,
                    99,
                );
            } catch (e) {
                error = e;
            }
            expect(error.variables).toEqual({ entityName, id: 99 });
        }
    });
});
