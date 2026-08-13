import { describe, expect, it } from 'vitest';

import { resolveCalculatedColumnJoin } from './calculated-column-join';

describe('resolveCalculatedColumnJoin()', () => {
    describe('when the expression does not reference the eager-join alias', () => {
        it('joins the relation under its own name', () => {
            expect(resolveCalculatedColumnJoin('order', 'lines')).toEqual({
                propertyPath: 'order.lines',
                alias: 'lines',
                joinType: 'inner',
            });
        });

        it('joins under its own name when the expression names a different relation', () => {
            expect(resolveCalculatedColumnJoin('order', 'lines', 'shippingLines.listPrice')).toEqual({
                propertyPath: 'order.lines',
                alias: 'lines',
                joinType: 'inner',
            });
        });

        it('joins under its own name when the expression uses the plain relation alias', () => {
            expect(resolveCalculatedColumnJoin('order', 'lines', 'lines.listPrice')).toEqual({
                propertyPath: 'order.lines',
                alias: 'lines',
                joinType: 'inner',
            });
        });
    });

    describe('when the expression references the eager-join alias', () => {
        it('joins under that alias with a left join', () => {
            expect(
                resolveCalculatedColumnJoin(
                    'productvariant',
                    'productVariantPrices',
                    'productvariant__productVariantPrices.price',
                ),
            ).toEqual({
                propertyPath: 'productvariant.productVariantPrices',
                alias: 'productvariant__productVariantPrices',
                joinType: 'left',
            });
        });

        it('matches the alias regardless of case', () => {
            expect(
                resolveCalculatedColumnJoin(
                    'productVariant',
                    'productVariantPrices',
                    'productvariant__productvariantprices.price',
                ),
            ).toEqual({
                propertyPath: 'productVariant.productVariantPrices',
                alias: 'productvariant__productvariantprices',
                joinType: 'left',
            });
        });
    });

    describe('nested relation paths', () => {
        it('uses the path as given and aliases on its last segment', () => {
            expect(resolveCalculatedColumnJoin('order', 'lines.productVariant')).toEqual({
                propertyPath: 'lines.productVariant',
                alias: 'productVariant',
                joinType: 'inner',
            });
        });

        it('builds the eager-style alias from the last segment', () => {
            expect(
                resolveCalculatedColumnJoin('order', 'lines.productVariant', 'order__productVariant.sku'),
            ).toEqual({
                propertyPath: 'lines.productVariant',
                alias: 'order__productVariant',
                joinType: 'left',
            });
        });
    });

    it('ignores an expression which does not start with an alias reference', () => {
        expect(resolveCalculatedColumnJoin('order', 'lines', 'SUM(order__lines.quantity)')).toEqual({
            propertyPath: 'order.lines',
            alias: 'lines',
            joinType: 'inner',
        });
    });
});
