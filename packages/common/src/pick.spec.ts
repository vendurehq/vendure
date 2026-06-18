import { describe, expect, it } from 'vitest';

import { pick } from './pick';

describe('pick()', () => {
    it('picks specified properties', () => {
        const input = {
            foo: 1,
            bar: 2,
            baz: [1, 2, 3],
        };

        const result = pick(input, ['foo', 'baz']);
        expect(result).toEqual({
            foo: 1,
            baz: [1, 2, 3],
        });
    });

    it('partially applies the pick when signle argument is array', () => {
        const input = {
            foo: 1,
            bar: 2,
            baz: [1, 2, 3],
        };

        const result = pick(['foo', 'baz']);
        expect(typeof result).toBe('function');
        expect(result(input)).toEqual({
            foo: 1,
            baz: [1, 2, 3],
        });
    });
});
