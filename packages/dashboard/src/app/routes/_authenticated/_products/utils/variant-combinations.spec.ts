import { describe, expect, it } from 'vitest';

import {
    generateVariantCombinations,
    optionIdSetKey,
    OptionGroup,
    partitionVariantCombinations,
} from './variant-combinations.js';

const size: OptionGroup = {
    id: 'g-size',
    code: 'size',
    name: 'Size',
    options: [
        { id: 'o-s', code: 's', name: 'S' },
        { id: 'o-m', code: 'm', name: 'M' },
    ],
};

const color: OptionGroup = {
    id: 'g-color',
    code: 'color',
    name: 'Color',
    options: [
        { id: 'o-red', code: 'red', name: 'Red' },
        { id: 'o-blue', code: 'blue', name: 'Blue' },
    ],
};

describe('generateVariantCombinations', () => {
    it('returns a single empty combination when there are no option groups', () => {
        expect(generateVariantCombinations([])).toEqual([
            { id: 'default', name: '', optionIds: [], optionNames: [] },
        ]);
    });

    it('ignores groups that have no options', () => {
        const emptyGroup: OptionGroup = { id: 'g-empty', code: 'empty', name: 'Empty', options: [] };
        expect(generateVariantCombinations([emptyGroup])).toEqual([
            { id: 'default', name: '', optionIds: [], optionNames: [] },
        ]);
    });

    it('returns one combination per value for a single group with one value', () => {
        const oneValue: OptionGroup = {
            id: 'g-size',
            code: 'size',
            name: 'Size',
            options: [{ id: 'o-s', code: 's', name: 'S' }],
        };
        expect(generateVariantCombinations([oneValue])).toEqual([
            { id: 'o-s', name: 'S', optionIds: ['o-s'], optionNames: ['S'] },
        ]);
    });

    it('produces the full cartesian product across groups', () => {
        const combinations = generateVariantCombinations([size, color]);
        expect(combinations.map(c => c.optionIds)).toEqual([
            ['o-s', 'o-red'],
            ['o-s', 'o-blue'],
            ['o-m', 'o-red'],
            ['o-m', 'o-blue'],
        ]);
    });
});

describe('partitionVariantCombinations', () => {
    it('partitions the full product minus the existing variants', () => {
        const { existing, missing } = partitionVariantCombinations(
            [size, color],
            [
                ['o-s', 'o-red'],
                ['o-m', 'o-blue'],
            ],
        );
        expect(existing.map(c => c.optionIds)).toEqual([
            ['o-s', 'o-red'],
            ['o-m', 'o-blue'],
        ]);
        expect(missing.map(c => c.optionIds)).toEqual([
            ['o-s', 'o-blue'],
            ['o-m', 'o-red'],
        ]);
    });

    it('reports every combination as missing when no variants exist yet', () => {
        const { existing, missing } = partitionVariantCombinations([size, color], []);
        expect(existing).toEqual([]);
        expect(missing).toHaveLength(4);
    });

    it('reports no missing combinations when all already exist', () => {
        const { existing, missing } = partitionVariantCombinations(
            [size, color],
            [
                ['o-s', 'o-red'],
                ['o-s', 'o-blue'],
                ['o-m', 'o-red'],
                ['o-m', 'o-blue'],
            ],
        );
        expect(missing).toEqual([]);
        expect(existing).toHaveLength(4);
    });

    it('matches existing variants regardless of option-id order', () => {
        // The existing variant stores its options in the reverse order to how the
        // combination is generated; it must still be recognised as existing.
        const { existing, missing } = partitionVariantCombinations(
            [size, color],
            [['o-red', 'o-s']],
        );
        expect(existing.map(c => c.optionIds)).toEqual([['o-s', 'o-red']]);
        expect(missing.map(c => c.optionIds)).toEqual([
            ['o-s', 'o-blue'],
            ['o-m', 'o-red'],
            ['o-m', 'o-blue'],
        ]);
    });

    it('treats a single empty existing variant as the default combination for a no-option product', () => {
        const { existing, missing } = partitionVariantCombinations([], [[]]);
        expect(existing.map(c => c.id)).toEqual(['default']);
        expect(missing).toEqual([]);
    });
});

describe('optionIdSetKey', () => {
    it('produces the same key regardless of option-id order', () => {
        expect(optionIdSetKey(['o-red', 'o-s'])).toBe(optionIdSetKey(['o-s', 'o-red']));
    });

    it('produces different keys for different option-id sets', () => {
        expect(optionIdSetKey(['o-s', 'o-red'])).not.toBe(optionIdSetKey(['o-s', 'o-blue']));
    });
});
