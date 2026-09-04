import { describe, expect, it } from 'vitest';

import { publicCollectionListOptions } from './collection-lookup';

describe('built-in collection lookup helpers', () => {
    it('keeps collections in the order the operator arranged them', () => {
        expect(publicCollectionListOptions({ limit: 5 })).toEqual({
            take: 5,
            skip: 0,
            sort: { position: 'ASC', id: 'ASC' },
            filter: { isPrivate: { eq: false } },
        });
    });
});
