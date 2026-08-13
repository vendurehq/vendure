import { describe, expect, it } from 'vitest';

const expectedExports = [
    'listOptions',
    'orderListOptions',
    'page',
    'paginationFields',
    'publicCollectionListOptions',
    'publicProductListOptions',
    'slicePage',
];

describe('built-in list helpers', () => {
    it('exports only the helpers consumed by the shipped tools', async () => {
        const listHelpers = await import('./list-helpers');

        expect(Object.keys(listHelpers).sort()).toEqual(expectedExports);
        expect(Object.values(listHelpers).every(value => typeof value === 'function')).toBe(true);
    });

    it('builds public product list options without losing the query filter', async () => {
        const { publicProductListOptions } = await import('./list-helpers');

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
