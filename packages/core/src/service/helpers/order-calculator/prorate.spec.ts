import { describe, expect, it } from 'vitest';

import { prorate } from './prorate';

describe('prorate()', () => {
    function testProrate(weights: number[], total: number, expected: number[]) {
        expect(prorate(weights, total)).toEqual(expected);
        expect(expected.reduce((a, b) => a + b, 0)).toBe(total);
    }

    it('single weight', () => {
        testProrate([123], 300, [300]);
    });
    it('distributes positive integer', () => {
        testProrate([4000, 2000, 2000], 300, [150, 75, 75]);
    });
    it('distributes negative integer', () => {
        testProrate([4000, 2000, 2000], -300, [-150, -75, -75]);
    });
    it('handles non-neatly divisible total', () => {
        testProrate([4300, 1400, 2300], 299, [161, 52, 86]);
    });
    it('distributes over equal weights', () => {
        testProrate([1000, 1000, 1000], 299, [100, 100, 99]);
    });
    it('many weights', () => {
        testProrate([10, 20, 10, 30, 50, 20, 10, 40], 95, [5, 10, 5, 15, 25, 10, 5, 20]);
    });
    it('many weights non-neatly divisible', () => {
        testProrate([10, 20, 10, 30, 50, 20, 10, 40], 93, [5, 10, 5, 15, 24, 10, 5, 19]);
    });
    it('weights include zero', () => {
        testProrate([10, 0], 40, [40, 0]);
    });
    it('all weights are zero', () => {
        testProrate([0, 0], 10, [5, 5]);
    });
    it('all weights are zero with zero total', () => {
        testProrate([0, 0], 0, [0, 0]);
    });
    it('amount is negative', () => {
        testProrate([100, 100], -20, [-10, -10]);
    });
});
