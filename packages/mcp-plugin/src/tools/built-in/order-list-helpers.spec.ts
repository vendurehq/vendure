import { describe, expect, it } from 'vitest';

import { ORDER_SORT_FIELDS, orderListOptions } from './order-list-helpers';

describe('built-in Order list helpers', () => {
    it('offers exactly the four sort fields list_orders turns into its sortBy enum', () => {
        expect(ORDER_SORT_FIELDS).toEqual(['orderPlacedAt', 'updatedAt', 'createdAt', 'total']);
    });

    it('sorts orders by the caller default unless asked otherwise, with an id tiebreaker', () => {
        expect(orderListOptions({}, 'updatedAt')).toEqual({
            take: 25,
            skip: 0,
            sort: { updatedAt: 'DESC', id: 'DESC' },
        });
        expect(orderListOptions({}, 'createdAt')).toEqual({
            take: 25,
            skip: 0,
            sort: { createdAt: 'DESC', id: 'DESC' },
        });
        expect(
            orderListOptions(
                {
                    limit: 5,
                    offset: 10,
                    sortBy: 'total',
                    sortDirection: 'ASC',
                },
                'updatedAt',
            ),
        ).toEqual({
            take: 5,
            skip: 10,
            sort: { total: 'ASC', id: 'ASC' },
        });
    });

    it('carries an order filter and the sort together', () => {
        expect(
            orderListOptions(
                {
                    filter: { state: { eq: 'ArrangingPayment' } },
                    sortBy: 'updatedAt',
                },
                'updatedAt',
            ),
        ).toEqual({
            take: 25,
            skip: 0,
            filter: { state: { eq: 'ArrangingPayment' } },
            sort: { updatedAt: 'DESC', id: 'DESC' },
        });
    });
});
