import { describe, expect, it } from 'vitest';

import { samplesEach } from './samples-each';

describe('samplesEach()', () => {
    it('single group match', () => {
        const result = samplesEach([1], [[1]]);
        expect(result).toBe(true);
    });

    it('single group no match', () => {
        const result = samplesEach([1], [[3, 4, 5]]);
        expect(result).toBe(false);
    });

    it('does not sample all groups', () => {
        const result = samplesEach(
            [1, 3],
            [
                [0, 1, 3],
                [2, 5, 4],
            ],
        );
        expect(result).toBe(false);
    });

    it('two groups in order', () => {
        const result = samplesEach(
            [1, 4],
            [
                [0, 1, 3],
                [2, 5, 4],
            ],
        );
        expect(result).toBe(true);
    });

    it('two groups not in order', () => {
        const result = samplesEach(
            [1, 4],
            [
                [2, 5, 4],
                [0, 1, 3],
            ],
        );
        expect(result).toBe(true);
    });

    it('three groups in order', () => {
        const result = samplesEach(
            [1, 4, 'a'],
            [
                [0, 1, 3],
                [2, 5, 4],
                ['b', 'a'],
            ],
        );
        expect(result).toBe(true);
    });

    it('three groups not in order', () => {
        const result = samplesEach(
            [1, 4, 'a'],
            [
                [2, 5, 4],
                ['b', 'a'],
                [0, 1, 3],
            ],
        );
        expect(result).toBe(true);
    });

    it('input is unchanged', () => {
        const input = [1, 4, 'a'];
        const result = samplesEach(input, [
            [2, 5, 4],
            ['b', 'a'],
            [0, 1, 3],
        ]);
        expect(result).toBe(true);
        expect(input).toEqual([1, 4, 'a']);
    });

    it('empty input arrays', () => {
        const result = samplesEach([], []);
        expect(result).toBe(true);
    });

    it('length mismatch', () => {
        const result = samplesEach(
            [1, 4, 5],
            [
                [2, 5, 4],
                [0, 1, 3],
            ],
        );
        expect(result).toBe(false);
    });
});
