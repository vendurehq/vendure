import { GraphQLResolveInfo, Kind, SelectionNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { isFieldInSelection } from './is-field-in-selection';

/**
 * Creates a mock GraphQLResolveInfo with the given selection structure.
 * This simulates a query like:
 * ```
 * collections {
 *   items {
 *     id
 *     name
 *     productVariantCount
 *   }
 * }
 * ```
 */
function createMockResolveInfo(
    childSelections: SelectionNode[],
    parentFieldName = 'items',
    fragments: GraphQLResolveInfo['fragments'] = {},
): GraphQLResolveInfo {
    return {
        fieldNodes: [
            {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: 'collections' },
                selectionSet: {
                    kind: Kind.SELECTION_SET,
                    selections: [
                        {
                            kind: Kind.FIELD,
                            name: { kind: Kind.NAME, value: parentFieldName },
                            selectionSet: {
                                kind: Kind.SELECTION_SET,
                                selections: childSelections,
                            },
                        },
                    ],
                },
            },
        ],
        fragments,
    } as unknown as GraphQLResolveInfo;
}

/**
 * Helper to create field selections from field names
 */
function createFieldSelections(fieldNames: string[]): SelectionNode[] {
    return fieldNames.map(field => ({
        kind: Kind.FIELD as const,
        name: { kind: Kind.NAME as const, value: field },
    }));
}

describe('isFieldInSelection', () => {
    describe('direct field selections', () => {
        it('returns true when field is in selection', () => {
            const info = createMockResolveInfo(createFieldSelections(['id', 'name', 'productVariantCount']));
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });

        it('returns false when field is not in selection', () => {
            const info = createMockResolveInfo(createFieldSelections(['id', 'name']));
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('returns false when parent field does not exist', () => {
            const info = createMockResolveInfo(createFieldSelections(['id', 'name']), 'nonexistent');
            expect(isFieldInSelection(info, 'id', 'items')).toBe(false);
        });

        it('works with custom parent field name', () => {
            const info = createMockResolveInfo(createFieldSelections(['id', 'name', 'slug']), 'children');
            expect(isFieldInSelection(info, 'slug', 'children')).toBe(true);
        });

        it('returns false when selection set is empty', () => {
            const info = createMockResolveInfo([]);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('is case-sensitive for field names', () => {
            const info = createMockResolveInfo(createFieldSelections(['productVariantCount']));
            expect(isFieldInSelection(info, 'ProductVariantCount')).toBe(false);
            expect(isFieldInSelection(info, 'productvariantcount')).toBe(false);
        });
    });

    describe('fragment spreads', () => {
        it('returns true when field is in a fragment spread', () => {
            // Simulates:
            // collections {
            //   items {
            //     ...CollectionFields
            //   }
            // }
            // fragment CollectionFields on Collection {
            //   id
            //   productVariantCount
            // }
            const fragments: GraphQLResolveInfo['fragments'] = {
                CollectionFields: {
                    kind: Kind.FRAGMENT_DEFINITION,
                    name: { kind: Kind.NAME, value: 'CollectionFields' },
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['id', 'productVariantCount']),
                    },
                },
            } as unknown as GraphQLResolveInfo['fragments'];

            const selections: SelectionNode[] = [
                {
                    kind: Kind.FRAGMENT_SPREAD,
                    name: { kind: Kind.NAME, value: 'CollectionFields' },
                },
            ];

            const info = createMockResolveInfo(selections, 'items', fragments);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });

        it('returns false when field is not in a fragment spread', () => {
            const fragments: GraphQLResolveInfo['fragments'] = {
                CollectionFields: {
                    kind: Kind.FRAGMENT_DEFINITION,
                    name: { kind: Kind.NAME, value: 'CollectionFields' },
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['id', 'name']),
                    },
                },
            } as unknown as GraphQLResolveInfo['fragments'];

            const selections: SelectionNode[] = [
                {
                    kind: Kind.FRAGMENT_SPREAD,
                    name: { kind: Kind.NAME, value: 'CollectionFields' },
                },
            ];

            const info = createMockResolveInfo(selections, 'items', fragments);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('handles mixed direct fields and fragment spreads', () => {
            // Simulates:
            // collections {
            //   items {
            //     id
            //     ...CollectionFields
            //   }
            // }
            const fragments: GraphQLResolveInfo['fragments'] = {
                CollectionFields: {
                    kind: Kind.FRAGMENT_DEFINITION,
                    name: { kind: Kind.NAME, value: 'CollectionFields' },
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['productVariantCount']),
                    },
                },
            } as unknown as GraphQLResolveInfo['fragments'];

            const selections: SelectionNode[] = [
                ...createFieldSelections(['id', 'name']),
                {
                    kind: Kind.FRAGMENT_SPREAD,
                    name: { kind: Kind.NAME, value: 'CollectionFields' },
                },
            ];

            const info = createMockResolveInfo(selections, 'items', fragments);
            expect(isFieldInSelection(info, 'id')).toBe(true);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });

        it('handles undefined fragment gracefully', () => {
            const selections: SelectionNode[] = [
                {
                    kind: Kind.FRAGMENT_SPREAD,
                    name: { kind: Kind.NAME, value: 'NonexistentFragment' },
                },
            ];

            const info = createMockResolveInfo(selections, 'items', {});
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('handles nested fragments', () => {
            // Simulates:
            // collections {
            //   items {
            //     ...OuterFragment
            //   }
            // }
            // fragment OuterFragment on Collection {
            //   id
            //   ...InnerFragment
            // }
            // fragment InnerFragment on Collection {
            //   productVariantCount
            // }
            const fragments: GraphQLResolveInfo['fragments'] = {
                OuterFragment: {
                    kind: Kind.FRAGMENT_DEFINITION,
                    name: { kind: Kind.NAME, value: 'OuterFragment' },
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: [
                            ...createFieldSelections(['id']),
                            {
                                kind: Kind.FRAGMENT_SPREAD,
                                name: { kind: Kind.NAME, value: 'InnerFragment' },
                            },
                        ],
                    },
                },
                InnerFragment: {
                    kind: Kind.FRAGMENT_DEFINITION,
                    name: { kind: Kind.NAME, value: 'InnerFragment' },
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['productVariantCount']),
                    },
                },
            } as unknown as GraphQLResolveInfo['fragments'];

            const selections: SelectionNode[] = [
                {
                    kind: Kind.FRAGMENT_SPREAD,
                    name: { kind: Kind.NAME, value: 'OuterFragment' },
                },
            ];

            const info = createMockResolveInfo(selections, 'items', fragments);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
            expect(isFieldInSelection(info, 'id')).toBe(true);
        });
    });

    describe('inline fragments', () => {
        it('returns true when field is in an inline fragment', () => {
            // Simulates:
            // collections {
            //   items {
            //     ... on Collection {
            //       productVariantCount
            //     }
            //   }
            // }
            const selections: SelectionNode[] = [
                {
                    kind: Kind.INLINE_FRAGMENT,
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['productVariantCount']),
                    },
                },
            ];

            const info = createMockResolveInfo(selections);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });

        it('returns false when field is not in an inline fragment', () => {
            const selections: SelectionNode[] = [
                {
                    kind: Kind.INLINE_FRAGMENT,
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['id', 'name']),
                    },
                },
            ];

            const info = createMockResolveInfo(selections);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('handles inline fragment without type condition', () => {
            // Simulates:
            // collections {
            //   items {
            //     ... {
            //       productVariantCount
            //     }
            //   }
            // }
            const selections: SelectionNode[] = [
                {
                    kind: Kind.INLINE_FRAGMENT,
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['productVariantCount']),
                    },
                },
            ];

            const info = createMockResolveInfo(selections);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });

        it('handles mixed direct fields and inline fragments', () => {
            const selections: SelectionNode[] = [
                ...createFieldSelections(['id']),
                {
                    kind: Kind.INLINE_FRAGMENT,
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'Collection' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: createFieldSelections(['productVariantCount']),
                    },
                },
            ];

            const info = createMockResolveInfo(selections);
            expect(isFieldInSelection(info, 'id')).toBe(true);
            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });
    });

    describe('parent field in fragments', () => {
        it('finds parent field inside a fragment spread', () => {
            // Simulates:
            // collections {
            //   ...PaginatedFields
            // }
            // fragment PaginatedFields on CollectionList {
            //   items {
            //     productVariantCount
            //   }
            // }
            const fragments: GraphQLResolveInfo['fragments'] = {
                PaginatedFields: {
                    kind: Kind.FRAGMENT_DEFINITION,
                    name: { kind: Kind.NAME, value: 'PaginatedFields' },
                    typeCondition: {
                        kind: Kind.NAMED_TYPE,
                        name: { kind: Kind.NAME, value: 'CollectionList' },
                    },
                    selectionSet: {
                        kind: Kind.SELECTION_SET,
                        selections: [
                            {
                                kind: Kind.FIELD,
                                name: { kind: Kind.NAME, value: 'items' },
                                selectionSet: {
                                    kind: Kind.SELECTION_SET,
                                    selections: createFieldSelections(['productVariantCount']),
                                },
                            },
                        ],
                    },
                },
            } as unknown as GraphQLResolveInfo['fragments'];

            const info = {
                fieldNodes: [
                    {
                        kind: Kind.FIELD,
                        name: { kind: Kind.NAME, value: 'collections' },
                        selectionSet: {
                            kind: Kind.SELECTION_SET,
                            selections: [
                                {
                                    kind: Kind.FRAGMENT_SPREAD,
                                    name: { kind: Kind.NAME, value: 'PaginatedFields' },
                                },
                            ],
                        },
                    },
                ],
                fragments,
            } as unknown as GraphQLResolveInfo;

            expect(isFieldInSelection(info, 'productVariantCount')).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('handles missing selection set on parent field', () => {
            const info = {
                fieldNodes: [
                    {
                        kind: Kind.FIELD,
                        name: { kind: Kind.NAME, value: 'collections' },
                        selectionSet: {
                            kind: Kind.SELECTION_SET,
                            selections: [
                                {
                                    kind: Kind.FIELD,
                                    name: { kind: Kind.NAME, value: 'items' },
                                    // No selectionSet
                                },
                            ],
                        },
                    },
                ],
                fragments: {},
            } as unknown as GraphQLResolveInfo;

            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('handles missing selection set on root field', () => {
            const info = {
                fieldNodes: [
                    {
                        kind: Kind.FIELD,
                        name: { kind: Kind.NAME, value: 'collections' },
                        // No selectionSet
                    },
                ],
                fragments: {},
            } as unknown as GraphQLResolveInfo;

            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });

        it('handles empty fieldNodes', () => {
            const info = {
                fieldNodes: [],
                fragments: {},
            } as unknown as GraphQLResolveInfo;

            expect(isFieldInSelection(info, 'productVariantCount')).toBe(false);
        });
    });
});
