import { describe, expect, it } from 'vitest';

import { mapProductsToSearchItems, mapVariantsToSearchItems } from './product-multi-selector-input.js';

// #4832 — covers the pure mapping the by-ID fetch feeds into the selection
// panel. The count/reopen wiring (counts from selectedIds.size, hydrate-once,
// dangling-ID reconciliation) is effect-driven and verified manually — see the
// PR description for the repro steps; the repo has no RTL and the e2e seed has
// fewer products than the search page cap, so it can't be exercised here.
describe('ProductMultiSelector by-id mapping', () => {
    it('maps products into the SearchItem shape keyed by productId', () => {
        const result = mapProductsToSearchItems([
            { id: 'p1', name: 'Laptop', slug: 'laptop', featuredAsset: { id: 'a1', preview: 'p1.jpg' } },
            { id: 'p2', name: 'Phone', slug: 'phone', featuredAsset: null },
        ]);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            productId: 'p1',
            productName: 'Laptop',
            slug: 'laptop',
            productAsset: { id: 'a1', preview: 'p1.jpg' },
        });
        // No featuredAsset → null, not undefined.
        expect(result[1].productAsset).toBeNull();
        // Variant fields are empty in product mode (identity comes from productId).
        expect(result[0].productVariantId).toBe('');
    });

    it('maps variants into the SearchItem shape keyed by productVariantId', () => {
        const result = mapVariantsToSearchItems([
            { id: 'v1', name: 'Laptop 13"', sku: 'LP-13', featuredAsset: { id: 'a2', preview: 'v1.jpg' } },
            { id: 'v2', name: 'Laptop 15"', sku: 'LP-15', featuredAsset: null },
        ]);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            productVariantId: 'v1',
            productVariantName: 'Laptop 13"',
            sku: 'LP-13',
            productVariantAsset: { id: 'a2', preview: 'v1.jpg' },
        });
        expect(result[1].productVariantAsset).toBeNull();
        // Product fields are empty in variant mode (identity comes from productVariantId).
        expect(result[0].productId).toBe('');
    });
});
