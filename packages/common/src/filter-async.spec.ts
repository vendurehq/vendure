import { describe, expect, it } from 'vitest';

import { filterAsync } from './filter-async';

describe('filterAsync', () => {
    it('filters an array of promises', async () => {
        const a = Promise.resolve(true);
        const b = Promise.resolve(false);
        const c = Promise.resolve(true);
        const input = [a, b, c];

        const result = await filterAsync(input, item => item);
        expect(result).toEqual([a, c]);
    });

    it('filters a mixed array', async () => {
        const a = { value: Promise.resolve(true) };
        const b = { value: Promise.resolve(false) };
        const c = { value: true };
        const input = [a, b, c];

        const result = await filterAsync(input, item => item.value);
        expect(result).toEqual([a, c]);
    });

    it('filters a sync array', async () => {
        const a = { value: true };
        const b = { value: false };
        const c = { value: true };
        const input = [a, b, c];

        const result = await filterAsync(input, item => item.value);
        expect(result).toEqual([a, c]);
    });
});
