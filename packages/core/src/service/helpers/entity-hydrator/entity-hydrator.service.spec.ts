import { describe, expect, it } from 'vitest';

import { EntityHydrator } from './entity-hydrator.service';

describe('EntityHydrator', () => {
    describe('getMissingRelations()', () => {
        function getMissingRelations(target: any, relations: string[]): string[] {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            return (hydrator as any).getMissingRelations(target, { relations });
        }

        // https://github.com/vendurehq/vendure/issues/4537
        it('detects a relation missing from a later array element', () => {
            const order = {
                lines: [
                    { productVariant: { product: { id: 1 } } },
                    { productVariant: { product: undefined } },
                ],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/4537
        it('detects an intermediate relation missing from a later array element', () => {
            const order = {
                lines: [{ productVariant: { product: { id: 1 } } }, { productVariant: undefined }],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);
        });

        it('detects a relation missing from a nested array element', () => {
            const order = {
                lines: [
                    {
                        productVariant: {
                            assets: [{ asset: { id: 1 } }, { asset: undefined }],
                        },
                    },
                ],
            };

            expect(getMissingRelations(order, ['lines.productVariant.assets.asset'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.assets',
                'lines.productVariant.assets.asset',
            ]);
        });

        it('reports nothing when every array element has the relation', () => {
            const order = {
                lines: [
                    { productVariant: { product: { id: 1 } } },
                    { productVariant: { product: { id: 2 } } },
                ],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([]);
        });

        it('treats a relation that is null in the database as loaded', () => {
            const order = {
                lines: [{ productVariant: { product: null } }, { productVariant: { product: null } }],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([]);
        });

        it('reports a relation missing from a sibling of a null relation', () => {
            const order = {
                lines: [{ productVariant: { product: null } }, { productVariant: { product: undefined } }],
            };

            expect(getMissingRelations(order, ['lines.productVariant.product'])).toEqual([
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);
        });

        it('reports nothing for a loaded empty array', () => {
            expect(getMissingRelations({ lines: [] }, ['lines'])).toEqual([]);
        });

        it('reports deeper relations of a loaded empty array as missing', () => {
            expect(getMissingRelations({ lines: [] }, ['lines.productVariant'])).toEqual([
                'lines',
                'lines.productVariant',
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/4955
        // Relation arrays can contain `undefined` holes (e.g. payments/surcharges/shippingLines
        // after OrderPlacedEvent). An `undefined` element was never fetched and must be reported
        // missing; only `null` counts as loaded.
        it('reports missing when the array has an undefined leading hole', () => {
            const order = { payments: [undefined, { refunds: [{ id: 1 }] }] };
            expect(getMissingRelations(order, ['payments.refunds'])).toEqual([
                'payments',
                'payments.refunds',
            ]);
        });

        it('does not crash when a loaded relation array is very large', () => {
            // Spreading a very large array into push() (`push(...value)`) exceeds V8's argument
            // limit and throws "RangeError: Maximum call stack size exceeded"; a plain loop must
            // be used instead. Reproduces e.g. `collections.productVariants` on a big catalog.
            //
            // The path must run PAST the large array: a relation at the end of the path is only
            // checked for presence, so its elements are never collected and the spread this test
            // guards against would not be reached.
            const collection = {
                productVariants: Array.from({ length: 200_000 }, (_, i) => ({
                    id: i,
                    product: { id: i },
                })),
            };
            expect(() => getMissingRelations(collection, ['productVariants.product'])).not.toThrow();
            expect(getMissingRelations(collection, ['productVariants.product'])).toEqual([]);
        });

        // A relation at the end of the path only needs to be checked for presence, so the walk
        // must not descend into the entities it points to. Descending is wasted work proportional
        // to the size of the relation, e.g. `collections.productVariants` on a big catalog.
        it('does not walk into the elements of an array at the end of the path', () => {
            class CountingArray extends Array {
                walked = 0;
                [Symbol.iterator]() {
                    this.walked++;
                    return super[Symbol.iterator]();
                }
            }
            const productVariants = new CountingArray();
            productVariants.push({ id: 1 }, { id: 2 }, { id: 3 });

            expect(getMissingRelations({ productVariants }, ['productVariants'])).toEqual([]);
            expect(productVariants.walked).toBe(0);
        });

        // Once one element is found to be missing the relation, the whole path is already known to
        // be missing, so there is nothing to learn from the remaining elements.
        it('stops checking array elements once one is found to be missing', () => {
            const visited = new Set<number>();
            // The relation is missing from an element in the middle rather than the first one, so
            // this also fails an implementation that only samples element [0] — issue #4537 itself.
            const missingAt = 7;
            const lines = Array.from({ length: 100 }, (_, i) => ({
                get productVariant() {
                    visited.add(i);
                    return i === missingAt ? undefined : { id: i };
                },
            }));

            expect(getMissingRelations({ lines }, ['lines.productVariant'])).toEqual([
                'lines',
                'lines.productVariant',
            ]);
            expect(visited.size).toBe(missingAt + 1);
        });

        // An `undefined` element settles the path on its own, so the walk must stop at it rather
        // than carry on reading the relation off every remaining element. Distinct from the test
        // above: that one exits on a present element whose relation is undefined, this one exits
        // on an element that is itself an `undefined` hole (issue #4955).
        it('stops walking the frontier at an undefined array element', () => {
            const read = new Set<number>();
            const lines: Array<Record<string, any> | undefined> = Array.from({ length: 100 }, (_, i) => ({
                get productVariant() {
                    read.add(i);
                    return { id: i };
                },
            }));
            lines[0] = undefined;

            expect(getMissingRelations({ lines }, ['lines.productVariant'])).toEqual([
                'lines',
                'lines.productVariant',
            ]);
            expect(read.size).toBe(0);
        });

        // An empty array mid-path leaves nothing to check further down, which settles the rest of
        // the path as missing, so the walk must stop there too.
        it('stops walking the frontier at an empty array mid-path', () => {
            const read = new Set<number>();
            const lines: Array<Record<string, any>> = Array.from({ length: 100 }, (_, i) => ({
                get assets() {
                    read.add(i);
                    return [{ asset: { id: i } }];
                },
            }));
            lines[0] = {
                get assets() {
                    read.add(0);
                    return [];
                },
            };

            expect(getMissingRelations({ lines }, ['lines.assets.asset'])).toEqual([
                'lines',
                'lines.assets',
                'lines.assets.asset',
            ]);
            expect(read.size).toBe(1);
        });
    });

    describe('getRelationEntityAtPath()', () => {
        // https://github.com/vendurehq/vendure/issues/4661
        it('treats undefined intermediate relations as terminal values', () => {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            const translation = { languageCode: 'en', name: 'Laptop' };
            const order = {
                lines: [
                    {
                        productVariant: {
                            translations: [translation],
                        },
                    },
                    {
                        productVariant: undefined,
                    },
                ],
            };

            const result = (hydrator as any).getRelationEntityAtPath(order, [
                'lines',
                'productVariant',
                'translations',
            ]);

            expect(result).toEqual([translation, undefined]);
        });
    });
});
