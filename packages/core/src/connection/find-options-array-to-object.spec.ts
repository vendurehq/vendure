import { describe, expect, it } from 'vitest';

import { findOptionsArrayToObject } from './find-options-array-to-object';
import { findOptionsObjectToArray } from './find-options-object-to-array';

describe('findOptionsArrayToObject()', () => {
    it('returns an empty object for an empty array', () => {
        expect(findOptionsArrayToObject([])).toEqual({});
    });

    it('converts top-level relations', () => {
        expect(findOptionsArrayToObject(['customer', 'lines'])).toEqual({
            customer: true,
            lines: true,
        });
    });

    it('expands a dotted path into nested objects', () => {
        expect(findOptionsArrayToObject(['lines.productVariant'])).toEqual({
            lines: { productVariant: true },
        });
    });

    it('expands deeply nested paths', () => {
        expect(findOptionsArrayToObject(['lines.productVariant.product.facetValues'])).toEqual({
            lines: { productVariant: { product: { facetValues: true } } },
        });
    });

    it('merges sibling paths under a shared parent', () => {
        expect(findOptionsArrayToObject(['lines.productVariant', 'lines.order'])).toEqual({
            lines: { productVariant: true, order: true },
        });
    });

    it('does not flatten a branch when the parent path is listed after it', () => {
        expect(findOptionsArrayToObject(['lines.productVariant', 'lines'])).toEqual({
            lines: { productVariant: true },
        });
    });

    it('does not flatten a branch when the parent path is listed before it', () => {
        expect(findOptionsArrayToObject(['lines', 'lines.productVariant'])).toEqual({
            lines: { productVariant: true },
        });
    });

    it('ignores empty path entries', () => {
        expect(findOptionsArrayToObject(['customer', ''])).toEqual({ customer: true });
    });

    it('round-trips with findOptionsObjectToArray', () => {
        const relations = {
            customer: true,
            lines: { productVariant: { product: true } },
        };
        const asArray = findOptionsObjectToArray(relations);
        expect(findOptionsArrayToObject(asArray)).toEqual(relations);
    });
});
