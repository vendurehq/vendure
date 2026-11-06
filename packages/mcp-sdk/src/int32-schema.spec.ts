import { describe, expect, it } from 'vitest';

import { GRAPHQL_INT_MAX, GRAPHQL_INT_MIN, int32Schema } from './int32-schema';

describe('int32Schema', () => {
    it('accepts whole numbers within the GraphQL Int range and refuses the rest', () => {
        const accepts = (value: number) => int32Schema.safeParse(value).success;
        expect(accepts(GRAPHQL_INT_MIN)).toBe(true);
        expect(accepts(GRAPHQL_INT_MAX)).toBe(true);
        expect(accepts(GRAPHQL_INT_MIN - 1)).toBe(false);
        expect(accepts(GRAPHQL_INT_MAX + 1)).toBe(false);
        expect(accepts(1.5)).toBe(false);
    });
});
