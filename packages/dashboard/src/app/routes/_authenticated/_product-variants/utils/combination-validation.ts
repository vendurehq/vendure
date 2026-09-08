import { optionIdSetKey } from '../../_products/utils/variant-combinations.js';

export interface SiblingVariant {
    id: string;
    name: string;
    sku: string;
    optionIds: string[];
}

/**
 * Returns the sibling variant that already uses the exact same set of option ids as
 * `selectedOptionIds`, or undefined if the combination is unique. Matching compares
 * option-id SETS (order-independent, via optionIdSetKey), reusing the same logic that
 * powers the product variants table. The variant being edited (`currentVariantId`) is
 * excluded so it never conflicts with itself.
 */
export function findConflictingVariant(
    selectedOptionIds: readonly string[],
    siblings: readonly SiblingVariant[],
    currentVariantId: string,
): SiblingVariant | undefined {
    const targetKey = optionIdSetKey(selectedOptionIds);
    return siblings.find(
        sibling => sibling.id !== currentVariantId && optionIdSetKey(sibling.optionIds) === targetKey,
    );
}
