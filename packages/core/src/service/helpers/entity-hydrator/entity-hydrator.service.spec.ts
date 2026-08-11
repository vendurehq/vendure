import { describe, expect, it } from 'vitest';

import { Asset } from '../../../entity/asset/asset.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { ProductPriceApplicator } from '../product-price-applicator/product-price-applicator';

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
        function getRelationEntityAtPath(target: any, path: string[]): any {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            return (hydrator as any).getRelationEntityAtPath(target, path);
        }

        // https://github.com/vendurehq/vendure/issues/4661
        it('treats undefined intermediate relations as terminal values', () => {
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

            const result = getRelationEntityAtPath(order, ['lines', 'productVariant', 'translations']);

            expect(result).toEqual([translation, undefined]);
        });

        it('does not crash when a terminal relation array is very large', () => {
            // A relation at the end of the path is collected element by element. `push(...target)`
            // expands the array into call arguments, which exceeds V8's stack budget and throws a
            // RangeError — the same failure fixed in getMissingRelations() in #4986. Reproduces
            // e.g. `collection.productVariants` on a big catalog.
            //
            // The limit is a stack budget rather than a fixed count, so it moves with the Node
            // version and the vitest pool (measured on Node 22: ~110k in a process, ~495k in a
            // worker thread). The fixture is sized well above both. The hole is deliberate:
            // `target.forEach(...)` would also avoid the RangeError but silently skips holes, and
            // the walk must preserve them.
            const variant = { id: 1 };
            const productVariants = new Array(1_000_000).fill(variant);
            delete productVariants[5];

            const result = getRelationEntityAtPath({ productVariants }, ['productVariants']);

            expect(result).toHaveLength(1_000_000);
            expect(result[5]).toBeUndefined();
        });
    });

    describe('getProductVariantsToPrice()', () => {
        function getProductVariantsToPrice(entity: any): ProductVariant[] {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            return (hydrator as any).getProductVariantsToPrice(entity);
        }

        // These pin the semantics of the helper rather than guard a regression: they are also
        // satisfied by the pre-helper code, which skipped all three shapes by other means.
        it('returns an empty array for an empty array', () => {
            expect(getProductVariantsToPrice([])).toEqual([]);
        });

        it('returns an empty array when the array contains only holes', () => {
            expect(getProductVariantsToPrice([null, undefined])).toEqual([]);
        });

        it('returns an empty array for non-ProductVariant entities', () => {
            const assets = [new Asset({ id: 1 }), new Asset({ id: 2 })];
            expect(getProductVariantsToPrice(assets)).toEqual([]);
        });

        it('wraps a bare ProductVariant in an array', () => {
            const variant = new ProductVariant({ id: 1 });
            expect(getProductVariantsToPrice(variant)).toEqual([variant]);
        });

        it('returns an empty array for undefined', () => {
            expect(getProductVariantsToPrice(undefined)).toEqual([]);
        });
    });

    describe('hydrate() with applyProductVariantPrices', () => {
        class TestOrder {
            id = 1;
            children?: any[];
        }
        class TestChild {}

        /**
         * Drives the real hydrate() against a stubbed query builder that returns a fixed
         * hydrated result. The ProductPriceApplicator is the real implementation with stubbed
         * strategies, so a crash in applyChannelPriceAndTax() is a real crash, not a mock
         * artefact. A relation array can contain `null`/`undefined` elements —
         * getRelationEntityAtPath() pushes them deliberately — and the price application at the
         * hydrate() call site must neither skip the whole array because of one (the `[0]` sample
         * did) nor pass one to applyChannelPriceAndTax(), which dereferences its argument.
         */
        function createHydrator(children: any[]) {
            const variantMetadata = {
                target: ProductVariant,
                findRelationWithPropertyPath: () => undefined,
            };
            const childMetadata = {
                target: TestChild,
                findRelationWithPropertyPath: (path: string) =>
                    path === 'variant' ? { inverseEntityMetadata: variantMetadata } : undefined,
            };
            const orderMetadata = {
                target: TestOrder,
                treeType: undefined,
                relations: [],
                findRelationWithPropertyPath: (path: string) =>
                    path === 'children' ? { inverseEntityMetadata: childMetadata } : undefined,
            };
            const queryBuilder = {
                alias: 'TestOrder',
                connection: { getMetadata: () => orderMetadata },
                expressionMap: { joinAttributes: [] },
                setFindOptions: () => queryBuilder,
                getOne: () => Promise.resolve({ children }),
            };
            const connection = {
                rawConnection: { entityMetadatas: [orderMetadata] },
                getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
            };
            const configService = {
                catalogOptions: {
                    productVariantPriceSelectionStrategy: {
                        selectPrice: (_ctx: any, prices: any[]) => Promise.resolve(prices[0]),
                    },
                    productVariantPriceCalculationStrategy: {
                        calculate: ({ inputPrice }: any) =>
                            Promise.resolve({ price: inputPrice, priceIncludesTax: false }),
                    },
                },
                taxOptions: {
                    taxZoneStrategy: { determineTaxZone: () => ({ id: 1 }) },
                },
            };
            const priceApplicator = new ProductPriceApplicator(
                configService as any,
                { getApplicableTaxRate: () => Promise.resolve({ id: 1 }) } as any,
                { getAllWithMembers: () => Promise.resolve([]) } as any,
                { get: (_ctx: any, _key: any, getValue: () => any) => getValue() } as any,
            );
            const translator = { translate: (entity: any) => entity };
            const hydrator = new EntityHydrator(connection as any, priceApplicator, translator as any);
            const ctx = { channelId: 1, currencyCode: 'USD' } as any;
            return { hydrator, ctx, target: new TestOrder() };
        }

        function createVariant(id: number): ProductVariant {
            return new ProductVariant({
                id,
                productVariantPrices: [{ price: 4200, currencyCode: 'USD' }] as any,
                taxCategory: { id: 1 } as any,
            });
        }

        it('prices a variant that sits behind a null array element', async () => {
            const variant = createVariant(1);
            const { hydrator, ctx, target } = createHydrator([{ variant: null }, { variant }]);

            await hydrator.hydrate(
                ctx,
                target as any,
                {
                    relations: ['children.variant'],
                    applyProductVariantPrices: true,
                } as any,
            );

            expect(variant.listPrice).toBe(4200);
        });

        it('does not pass a null array element to the price applicator', async () => {
            const variant = createVariant(1);
            const { hydrator, ctx, target } = createHydrator([{ variant }, { variant: null }]);

            await hydrator.hydrate(
                ctx,
                target as any,
                {
                    relations: ['children.variant'],
                    applyProductVariantPrices: true,
                } as any,
            );

            expect(variant.listPrice).toBe(4200);
        });

        it('prices every element when the array is fully populated', async () => {
            const variant1 = createVariant(1);
            const variant2 = createVariant(2);
            const { hydrator, ctx, target } = createHydrator([{ variant: variant1 }, { variant: variant2 }]);

            await hydrator.hydrate(
                ctx,
                target as any,
                {
                    relations: ['children.variant'],
                    applyProductVariantPrices: true,
                } as any,
            );

            expect(variant1.listPrice).toBe(4200);
            expect(variant2.listPrice).toBe(4200);
        });
    });

    describe('isTranslatable()', () => {
        function isTranslatable(input: any): boolean {
            const hydrator = new EntityHydrator(undefined as any, undefined as any, undefined as any);
            return (hydrator as any).isTranslatable(input);
        }
        const translatable = { translations: [{ languageCode: 'en', name: 'Laptop' }] };

        // A relation array can contain `null` (fetched but null on that element) or `undefined`
        // (never fetched) entries — getRelationEntityAtPath() pushes both deliberately — so
        // whether the relation is translatable cannot be decided from element [0] alone.
        it('detects a translatable entity after a null leading element', () => {
            expect(isTranslatable([null, translatable])).toBe(true);
        });

        it('detects a translatable entity after an undefined leading hole', () => {
            expect(isTranslatable([undefined, translatable])).toBe(true);
        });

        // The falsy side: an array with nothing translatable must report false
        it('reports false for an empty array', () => {
            expect(isTranslatable([])).toBe(false);
        });

        it('reports false when no element is translatable', () => {
            expect(isTranslatable([null, null])).toBe(false);
            expect(isTranslatable([{ id: 1 }, null])).toBe(false);
        });
    });
});
