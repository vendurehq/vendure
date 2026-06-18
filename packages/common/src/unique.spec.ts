import { describe, expect, it } from 'vitest';

import { unique } from './unique';

describe('unique()', () => {
    it('works with primitive values', () => {
        expect(unique([1, 1, 2, 3, 2, 6, 4, 2])).toEqual([1, 2, 3, 6, 4]);
        expect(unique(['a', 'f', 'g', 'f', 'y'])).toEqual(['a', 'f', 'g', 'y']);
        expect(unique([null, null, 1, 'a', 1])).toEqual([null, 1, 'a']);
    });

    it('works with object references', () => {
        const a = { a: true };
        const b = { b: true };
        const c = { c: true };

        expect(unique([a, b, a, b, c, a])).toEqual([a, b, c]);
        expect(unique([a, b, a, b, c, a])[0]).toBe(a);
        expect(unique([a, b, a, b, c, a])[1]).toBe(b);
        expect(unique([a, b, a, b, c, a])[2]).toBe(c);
    });

    it('works with object key param', () => {
        const a = { id: 'a', a: true };
        const b = { id: 'b', b: true };
        const c = { id: 'c', c: true };
        const d = { id: 'a', d: true };

        expect(unique([a, b, a, b, d, c, a], 'id')).toEqual([a, b, c]);
    });

    it('works an empty array', () => {
        expect(unique([])).toEqual([]);
    });

    it('perf on primitive array', () => {
        const bigArray = Array.from({ length: 50000 }).map(() => Math.random().toString().substr(2, 5));
        const timeStart = new Date().getTime();
        unique(bigArray);
        const timeEnd = new Date().getTime();
        expect(timeEnd - timeStart).toBeLessThan(100);
    });

    it('perf on object array', () => {
        const bigArray = Array.from({ length: 50000 })
            .map(() => Math.random().toString().substr(2, 5))
            .map(id => ({ id }));
        const timeStart = new Date().getTime();
        unique(bigArray, 'id');
        const timeEnd = new Date().getTime();
        expect(timeEnd - timeStart).toBeLessThan(100);
    });
});
