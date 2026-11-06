import { describe, expect, it } from 'vitest';

import { productSearchWords, publicProductListOptions } from './product-search-query';

describe('built-in product search query', () => {
    it('requires every search word to match the product name or slug', () => {
        expect(publicProductListOptions({ limit: 10, offset: 5 }, ['camera', 'bag'])).toEqual({
            take: 10,
            skip: 5,
            sort: { createdAt: 'DESC', id: 'DESC' },
            filter: {
                enabled: { eq: true },
                _and: [
                    { _or: [{ name: { contains: 'camera' } }, { slug: { contains: 'camera' } }] },
                    { _or: [{ name: { contains: 'bag' } }, { slug: { contains: 'bag' } }] },
                ],
            },
        });
    });

    it('drops the word filter entirely when nothing was searched for', () => {
        // An empty _and would produce an empty bracket in the SQL, so it has to be left out.
        expect(publicProductListOptions({})).toEqual({
            take: 25,
            skip: 0,
            sort: { createdAt: 'DESC', id: 'DESC' },
            filter: { enabled: { eq: true } },
        });
    });

    it('splits a query into words and leaves them as typed by default', () => {
        expect(productSearchWords('  Camera   Bags ')).toEqual(['Camera', 'Bags']);
        expect(productSearchWords(undefined)).toEqual([]);
        expect(productSearchWords('   ')).toEqual([]);
    });

    it('trims plural endings only when asked to', () => {
        const trimmed = (query: string) => productSearchWords(query, true);
        expect(trimmed('cameras bags shoes')).toEqual(['camera', 'bag', 'shoe']);
        expect(trimmed('boxes watches dresses lenses')).toEqual(['box', 'watch', 'dress', 'lens']);
        expect(trimmed('glass class gas bus')).toEqual(['glass', 'class', 'gas', 'bus']);
        expect(trimmed('camera folding')).toEqual(['camera', 'folding']);
        // A singular noun ending in one "s" is over-trimmed. Trimming the end of a word can only
        // widen a substring match, so "len" still finds "Lens", and this pass runs only after the
        // words as typed have already found nothing.
        expect(trimmed('lens')).toEqual(['len']);
    });
});
