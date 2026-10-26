import { SearchResultSortParameter, SortOrder } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { hasSortParameter } from './search-strategy-utils';

describe('hasSortParameter()', () => {
    it('returns false when no sort parameter was given', () => {
        expect(hasSortParameter(undefined)).toBe(false);
        expect(hasSortParameter(null)).toBe(false);
    });

    it('returns false for an empty sort object', () => {
        expect(hasSortParameter({})).toBe(false);
    });

    it('returns false when all sort fields are null or undefined', () => {
        // GraphQL can deliver an explicit null at runtime, which the generated input type does not model
        expect(
            hasSortParameter({ name: null, price: undefined } as unknown as SearchResultSortParameter),
        ).toBe(false);
    });

    it('returns true when at least one sort field is set', () => {
        expect(hasSortParameter({ name: SortOrder.ASC })).toBe(true);
        expect(hasSortParameter({ price: SortOrder.DESC })).toBe(true);
        // GraphQL can deliver an explicit null at runtime, which the generated input type does not model
        expect(
            hasSortParameter({ name: null, price: SortOrder.ASC } as unknown as SearchResultSortParameter),
        ).toBe(true);
    });
});
