import { describe, expect, it } from 'vitest';

import { toRangeBucket } from './range-bucket.helper';

describe('toRangeBucket()', () => {
    describe('boundary values', () => {
        it('returns "0" for count of 0', () => {
            expect(toRangeBucket(0)).toBe('0');
        });

        it('returns "1-100" for count of 1', () => {
            expect(toRangeBucket(1)).toBe('1-100');
        });

        it('returns "1-100" for count of 100', () => {
            expect(toRangeBucket(100)).toBe('1-100');
        });

        it('returns "101-1k" for count of 101', () => {
            expect(toRangeBucket(101)).toBe('101-1k');
        });

        it('returns "101-1k" for count of 1000', () => {
            expect(toRangeBucket(1000)).toBe('101-1k');
        });

        it('returns "1k-10k" for count of 1001', () => {
            expect(toRangeBucket(1001)).toBe('1k-10k');
        });

        it('returns "1k-10k" for count of 10000', () => {
            expect(toRangeBucket(10000)).toBe('1k-10k');
        });

        it('returns "10k-100k" for count of 10001', () => {
            expect(toRangeBucket(10001)).toBe('10k-100k');
        });

        it('returns "10k-100k" for count of 100000', () => {
            expect(toRangeBucket(100000)).toBe('10k-100k');
        });

        it('returns "100k+" for count of 100001', () => {
            expect(toRangeBucket(100001)).toBe('100k+');
        });
    });

    describe('values within each bucket', () => {
        it('handles counts within "1-100" range', () => {
            expect(toRangeBucket(50)).toBe('1-100');
        });

        it('handles counts within "101-1k" range', () => {
            expect(toRangeBucket(500)).toBe('101-1k');
        });

        it('handles counts within "1k-10k" range', () => {
            expect(toRangeBucket(5000)).toBe('1k-10k');
        });

        it('handles counts within "10k-100k" range', () => {
            expect(toRangeBucket(50000)).toBe('10k-100k');
        });

        it('handles counts within "100k+" range', () => {
            expect(toRangeBucket(1000000)).toBe('100k+');
        });
    });

    describe('edge cases', () => {
        // Note: Negative counts are not expected in normal usage (entity counts
        // should never be negative). The function treats negative numbers as
        // falling into the "1-100" bucket since they satisfy `count <= 100`.
        // This documents the current behavior rather than prescribing it.
        it('treats negative numbers as falling into "1-100" bucket', () => {
            expect(toRangeBucket(-1)).toBe('1-100');
            expect(toRangeBucket(-100)).toBe('1-100');
        });
    });
});
