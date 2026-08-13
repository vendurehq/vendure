export interface VariantOption {
    id: string;
    code: string;
    name: string;
}

export interface OptionGroup {
    id: string;
    code: string;
    name: string;
    options: VariantOption[];
}

export interface GeneratedVariant {
    id: string;
    name: string;
    optionIds: string[];
    optionNames: string[];
}

export interface PartitionedCombinations {
    /** Combinations that already exist as variants on the product. */
    existing: GeneratedVariant[];
    /** Combinations that have no matching variant yet. */
    missing: GeneratedVariant[];
}

/**
 * Computes the full cartesian product of the option groups' values. Groups with no
 * options are ignored; if that leaves no groups (a product with no options) a single
 * empty "default" combination is returned so the simple-product flow still works.
 */
export function generateVariantCombinations(optionGroups: OptionGroup[]): GeneratedVariant[] {
    const validGroups = optionGroups.filter(g => g.options.length > 0);
    if (validGroups.length === 0) {
        return [{ id: 'default', name: '', optionIds: [], optionNames: [] }];
    }

    const combine = (
        groups: OptionGroup[],
        index: number,
        current: { id: string; name: string }[],
    ): GeneratedVariant[] => {
        if (index === groups.length) {
            return [
                {
                    id: current.map(c => c.id).join('-'),
                    name: current.map(c => c.name).join(' '),
                    optionIds: current.map(c => c.id),
                    optionNames: current.map(c => c.name),
                },
            ];
        }
        const results: GeneratedVariant[] = [];
        for (const option of groups[index].options) {
            results.push(...combine(groups, index + 1, [...current, { id: option.id, name: option.name }]));
        }
        return results;
    };

    return combine(validGroups, 0, []);
}

/**
 * Order-independent key for a set of option ids. Two variants belong to the same
 * combination when they reference the same set of option ids, regardless of the
 * order in which those ids happen to be stored.
 */
export function optionIdSetKey(optionIds: readonly string[]): string {
    // Explicit locale-independent comparator: both sides of a key comparison must
    // produce the same ordering regardless of runtime locale.
    return [...optionIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('::');
}

/**
 * Given the product's option groups and the option-id sets of its existing variants,
 * computes the full cartesian product and partitions it into the combinations that
 * already exist versus the ones still missing. Matching compares option-id SETS, so
 * a variant matches its combination irrespective of option ordering.
 */
export function partitionVariantCombinations(
    optionGroups: OptionGroup[],
    existingOptionIdSets: ReadonlyArray<readonly string[]>,
): PartitionedCombinations {
    const combinations = generateVariantCombinations(optionGroups);
    const existingKeys = new Set(existingOptionIdSets.map(optionIdSetKey));

    const existing: GeneratedVariant[] = [];
    const missing: GeneratedVariant[] = [];
    for (const combination of combinations) {
        if (existingKeys.has(optionIdSetKey(combination.optionIds))) {
            existing.push(combination);
        } else {
            missing.push(combination);
        }
    }
    return { existing, missing };
}
