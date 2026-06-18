import { describe, expect, it } from 'vitest';

import { generateAllCombinations, isClassInstance } from './shared-utils';

describe('generateAllCombinations()', () => {
    it('works with an empty input array', () => {
        const result = generateAllCombinations([]);
        expect(result).toEqual([]);
    });

    it('works with an input of length 1', () => {
        const result = generateAllCombinations([['red', 'green', 'blue']]);
        expect(result).toEqual([['red'], ['green'], ['blue']]);
    });

    it('works with an input of length 2', () => {
        const result = generateAllCombinations([
            ['red', 'green', 'blue'],
            ['small', 'large'],
        ]);
        expect(result).toEqual([
            ['red', 'small'],
            ['red', 'large'],
            ['green', 'small'],
            ['green', 'large'],
            ['blue', 'small'],
            ['blue', 'large'],
        ]);
    });

    it('works with second array empty', () => {
        const result = generateAllCombinations([['red', 'green', 'blue'], []]);
        expect(result).toEqual([['red'], ['green'], ['blue']]);
    });
});

describe('isClassInstance()', () => {
    it('returns true for class instances', () => {
        expect(isClassInstance(new Date())).toBe(true);
        expect(isClassInstance(new Foo())).toBe(true);
        // eslint-disable-next-line no-new-wrappers
        expect(isClassInstance(new Number(1))).toBe(true);
    });

    it('returns false for not class instances', () => {
        expect(isClassInstance(Date)).toBe(false);
        expect(isClassInstance(1)).toBe(false);
        expect(isClassInstance(Number)).toBe(false);
        expect(isClassInstance({ a: 1 })).toBe(false);
        expect(isClassInstance([1, 2, 3])).toBe(false);
    });

    class Foo {}
});
