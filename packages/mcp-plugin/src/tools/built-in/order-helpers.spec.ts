import { describe, expect, it } from 'vitest';

const expectedExports = [
    'DEFAULT_LIST_PAGE_SIZE',
    'listOptions',
    'orderListOptions',
    'page',
    'paginationFields',
    'productListOptions',
    'publicCollectionListOptions',
    'publicProductListOptions',
    'slicePage',
];

describe('built-in order helpers', () => {
    it('exports only the helpers consumed by the shipped tools', async () => {
        const orderHelpers = await import('./order-helpers');

        expect(Object.keys(orderHelpers).sort()).toEqual(expectedExports);
        expect(
            Object.values(orderHelpers).every(
                value => typeof value === 'function' || typeof value === 'number',
            ),
        ).toBe(true);
    });

    it('builds public product list options without losing the query filter', async () => {
        const { publicProductListOptions } = await import('./order-helpers');

        expect(publicProductListOptions({ limit: 10, offset: 5, query: 'shoe' })).toEqual({
            take: 10,
            skip: 5,
            filter: {
                _or: [{ name: { contains: 'shoe' } }, { slug: { contains: 'shoe' } }],
                enabled: { eq: true },
            },
        });
    });
});
