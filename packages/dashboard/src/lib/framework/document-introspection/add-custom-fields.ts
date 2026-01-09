import { Variables } from '@/vdb/graphql/api.js';
import {
    getServerConfigDocument,
    relationCustomFieldFragment,
    structCustomFieldFragment,
} from '@/vdb/providers/server-config.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { CustomFieldConfig } from '@vendure/common/lib/generated-types';
import { ResultOf } from 'gql.tada';
import {
    DefinitionNode,
    DocumentNode,
    FieldNode,
    FragmentDefinitionNode,
    Kind,
    OperationDefinitionNode,
    SelectionNode,
    SelectionSetNode,
} from 'graphql';

import { getOperationTypeInfo } from './get-document-structure.js';

type StructCustomFieldFragment = ResultOf<typeof structCustomFieldFragment>;
type RelationCustomFieldFragment = ResultOf<typeof relationCustomFieldFragment>;

let globalCustomFieldsMap: Map<string, CustomFieldConfig[]> = new Map();

// Memoization cache using WeakMap to avoid memory leaks
const memoizationCache = new WeakMap<DocumentNode, Map<string, TypedDocumentNode<any, any>>>();
const fragmentMemoizationCache = new WeakMap<DocumentNode, Map<string, TypedDocumentNode<any, any>>>();

/**
 * Creates a cache key for the options object
 */
function createOptionsKey(options?: {
    customFieldsMap?: Map<string, CustomFieldConfig[]>;
    includeCustomFields?: string[];
    includeNestedFragments?: string[];
}): string {
    if (!options) return 'default';

    const parts: string[] = [];

    if (options.customFieldsMap) {
        // Create a deterministic key for the customFieldsMap
        const mapEntries = Array.from(options.customFieldsMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}:${value.length}`);
        parts.push(`map:${mapEntries.join(',')}`);
    }

    if (options.includeCustomFields) {
        parts.push(`include:${options.includeCustomFields.sort().join(',')}`);
    }

    if (options.includeNestedFragments) {
        parts.push(`nested:${options.includeNestedFragments.sort().join(',')}`);
    }

    return parts.join('|') || 'default';
}

/**
 * @description
 * This function is used to set the global custom fields map.
 * It is called when the server config is loaded, and then can
 * be used in other parts of the app via the `getCustomFieldsMap` function.
 */
export function setCustomFieldsMap(
    entityCustomFields: ResultOf<
        typeof getServerConfigDocument
    >['globalSettings']['serverConfig']['entityCustomFields'],
) {
    globalCustomFieldsMap = new Map<string, CustomFieldConfig[]>();
    for (const entityCustomField of entityCustomFields) {
        globalCustomFieldsMap.set(
            entityCustomField.entityName,
            entityCustomField.customFields as CustomFieldConfig[],
        );
    }
}

/**
 * @description
 * This function is used to get the global custom fields map.
 */
export function getCustomFieldsMap() {
    return globalCustomFieldsMap;
}

/**
 * @description
 * Internal helper function that applies custom fields to a selection set for a given entity type.
 * This is the core logic extracted for reuse.
 */
function applyCustomFieldsToSelection(
    typeName: string,
    selectionSet: SelectionSetNode,
    customFields: Map<string, CustomFieldConfig[]>,
    options?: {
        includeCustomFields?: string[];
    },
): void {
    let entityType = typeName;

    if (entityType === ('OrderAddress' as any)) {
        // OrderAddress is a special case of the Address entity, and shares its custom fields
        // so we treat it as an alias
        entityType = 'Address';
    }

    if (entityType === ('Country' as any)) {
        // Country is an alias of Region
        entityType = 'Region';
    }

    const customFieldsForType = customFields.get(entityType);
    if (customFieldsForType && customFieldsForType.length) {
        // Check if there is already a customFields field in the fragment
        // to avoid duplication
        const selectionsArray = selectionSet.selections as SelectionNode[];
        const existingCustomFieldsFieldIndex = selectionsArray.findIndex(
            selection => isFieldNode(selection) && selection.name.value === 'customFields',
        );
        const existingCustomFieldsField =
            existingCustomFieldsFieldIndex !== -1
                ? (selectionsArray[existingCustomFieldsFieldIndex] as FieldNode)
                : undefined;
        const selectionNodes: SelectionNode[] = customFieldsForType
            .filter(
                field => !options?.includeCustomFields || options?.includeCustomFields.includes(field.name),
            )
            .map(
                customField =>
                    ({
                        kind: Kind.FIELD,
                        name: {
                            kind: Kind.NAME,
                            value: customField.name,
                        },
                        // For "relation" custom fields, we need to also select
                        // all the scalar fields of the related type
                        ...(customField.type === 'relation'
                            ? {
                                  selectionSet: {
                                      kind: Kind.SELECTION_SET,
                                      selections: (
                                          customField as RelationCustomFieldFragment
                                      ).scalarFields.map(f => ({
                                          kind: Kind.FIELD,
                                          name: { kind: Kind.NAME, value: f },
                                      })),
                                  },
                              }
                            : {}),
                        ...(customField.type === 'struct'
                            ? {
                                  selectionSet: {
                                      kind: Kind.SELECTION_SET,
                                      selections: (customField as StructCustomFieldFragment).fields.map(
                                          f => ({
                                              kind: Kind.FIELD,
                                              name: { kind: Kind.NAME, value: f.name },
                                          }),
                                      ),
                                  },
                              }
                            : {}),
                    }) as FieldNode,
            );
        if (!existingCustomFieldsField) {
            // If no customFields field exists, add one
            selectionsArray.push({
                kind: Kind.FIELD,
                name: {
                    kind: Kind.NAME,
                    value: 'customFields',
                },
                selectionSet: {
                    kind: Kind.SELECTION_SET,
                    selections: selectionNodes,
                },
            });
        } else if (existingCustomFieldsFieldIndex !== -1) {
            // If a customFields field already exists, replace it with an updated node
            const updatedField: FieldNode = {
                ...existingCustomFieldsField,
                selectionSet: {
                    kind: Kind.SELECTION_SET,
                    selections: selectionNodes,
                },
            };
            selectionsArray[existingCustomFieldsFieldIndex] = updatedField;
        }

        const localizedFields = customFieldsForType.filter(
            field => field.type === 'localeString' || field.type === 'localeText',
        );

        const translationsField = selectionSet.selections
            .filter(isFieldNode)
            .find(field => field.name.value === 'translations');

        if (localizedFields.length) {
            const existingSelections = selectionSet.selections as SelectionNode[];
            const translationsFieldIndex = existingSelections.findIndex(
                selection => isFieldNode(selection) && selection.name.value === 'translations',
            );

            const ensureTranslationSelectionSet = (field: FieldNode | undefined): SelectionSetNode =>
                field?.selectionSet ??
                ({
                    kind: Kind.SELECTION_SET,
                    selections: [
                        {
                            kind: Kind.FIELD,
                            name: { kind: Kind.NAME, value: 'languageCode' },
                        },
                    ],
                } as SelectionSetNode);

            let selectionSetForTranslations: SelectionSetNode;

            if (translationsFieldIndex === -1) {
                // No translations field yet – create one
                selectionSetForTranslations = ensureTranslationSelectionSet(undefined);
                const newTranslationsField: FieldNode = {
                    kind: Kind.FIELD,
                    name: { kind: Kind.NAME, value: 'translations' },
                    selectionSet: selectionSetForTranslations,
                };
                existingSelections.push(newTranslationsField);
            } else {
                const existingField = existingSelections[translationsFieldIndex] as FieldNode;
                selectionSetForTranslations = ensureTranslationSelectionSet(existingField);
                const updatedField: FieldNode = {
                    ...existingField,
                    selectionSet: selectionSetForTranslations,
                };
                existingSelections[translationsFieldIndex] = updatedField;
            }

            // Always include locale custom fields inside translations
            (selectionSetForTranslations.selections as SelectionNode[]).push({
                name: {
                    kind: Kind.NAME,
                    value: 'customFields',
                },
                kind: Kind.FIELD,
                selectionSet: {
                    kind: Kind.SELECTION_SET,
                    selections: localizedFields.map(
                        customField =>
                            ({
                                kind: Kind.FIELD,
                                name: {
                                    kind: Kind.NAME,
                                    value: customField.name,
                                },
                            }) as FieldNode,
                    ),
                },
            });
        }
    }
}

/**
 * @description
 * Adds custom fields to a single fragment document. This is a more granular version of `addCustomFields()`
 * that operates on individual fragments, allowing for better composability.
 *
 * **Important behavior with fragment dependencies:**
 * - When a document contains multiple fragments (e.g., a main fragment with dependencies passed to `graphql()`),
 *   only the **first fragment** is modified with custom fields.
 * - Any additional fragments (dependencies) are left untouched in the output document.
 * - This allows you to selectively control which fragments get custom fields.
 *
 * This function is memoized to return a stable identity for given inputs.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const modifiedFragment = addCustomFieldsToFragment(orderDetailFragment, {
 *     includeCustomFields: ['reviewCount', 'priority']
 * });
 *
 * // With fragment dependencies (only OrderDetail gets custom fields, OrderLine doesn't)
 * const orderDetailFragment = graphql(
 *     `fragment OrderDetail on Order {
 *         id
 *         lines { ...OrderLine }
 *     }`,
 *     [orderLineFragment]  // This dependency won't get custom fields
 * );
 * const modified = addCustomFieldsToFragment(orderDetailFragment);
 * ```
 */
export function addCustomFieldsToFragment<T, V extends Variables = Variables>(
    fragmentDocument: DocumentNode | TypedDocumentNode<T, V>,
    options?: {
        customFieldsMap?: Map<string, CustomFieldConfig[]>;
        includeCustomFields?: string[];
    },
): TypedDocumentNode<T, V> {
    const optionsKey = createOptionsKey(options);

    // Check if we have a cached result for this fragment and options
    let documentCache = fragmentMemoizationCache.get(fragmentDocument);
    if (!documentCache) {
        documentCache = new Map();
        fragmentMemoizationCache.set(fragmentDocument, documentCache);
    }

    const cachedResult = documentCache.get(optionsKey);
    if (cachedResult) {
        return cachedResult as TypedDocumentNode<T, V>;
    }

    // Validate that this is a fragment-only document
    const fragmentDefs = fragmentDocument.definitions.filter(isFragmentDefinition);
    const queryDefs = fragmentDocument.definitions.filter(isOperationDefinition);

    if (queryDefs.length > 0) {
        throw new Error(
            'addCustomFieldsToFragment() expects a fragment-only document. Use addCustomFields() for documents with queries.',
        );
    }

    if (fragmentDefs.length === 0) {
        throw new Error(
            'addCustomFieldsToFragment() expects a document with at least one fragment definition.',
        );
    }

    // Clone the document
    const clone = JSON.parse(JSON.stringify(fragmentDocument)) as DocumentNode;
    const customFields = options?.customFieldsMap || globalCustomFieldsMap;

    // Only modify the first fragment (the main one)
    // Any additional fragments are dependencies and should be left untouched
    const fragmentDef = clone.definitions.find(isFragmentDefinition) as FragmentDefinitionNode;

    // Apply custom fields only to the first/main fragment
    applyCustomFieldsToSelection(
        fragmentDef.typeCondition.name.value,
        fragmentDef.selectionSet,
        customFields,
        options,
    );

    // Cache the result before returning
    documentCache.set(optionsKey, clone);
    return clone;
}

/**
 * Given a GraphQL AST (DocumentNode), this function looks for fragment definitions and adds and configured
 * custom fields to those fragments.
 *
 * By default, only adds custom fields to top-level fragments (those used directly in the query result).
 * Use `includeNestedFragments` to also add custom fields to specific nested fragments.
 *
 * This function is memoized to return a stable identity for given inputs.
 */
export function addCustomFields<T, V extends Variables = Variables>(
    documentNode: DocumentNode | TypedDocumentNode<T, V>,
    options?: {
        customFieldsMap?: Map<string, CustomFieldConfig[]>;
        includeCustomFields?: string[];
        /**
         * Names of nested fragments that should also get custom fields.
         * By default, only top-level fragments get custom fields.
         *
         * @example
         * ```typescript
         * addCustomFields(orderDetailDocument, {
         *     includeNestedFragments: ['OrderLine', 'Asset']
         * })
         * ```
         */
        includeNestedFragments?: string[];
    },
): TypedDocumentNode<T, V> {
    const optionsKey = createOptionsKey(options);

    // Check if we have a cached result for this document and options
    let documentCache = memoizationCache.get(documentNode);
    if (!documentCache) {
        documentCache = new Map();
        memoizationCache.set(documentNode, documentCache);
    }

    const cachedResult = documentCache.get(optionsKey);
    if (cachedResult) {
        return cachedResult as TypedDocumentNode<T, V>;
    }

    // If not cached, compute the result
    const clone = JSON.parse(JSON.stringify(documentNode)) as DocumentNode;
    const customFields = options?.customFieldsMap || globalCustomFieldsMap;

    const targetNodes: Array<{ typeName: string; selectionSet: SelectionSetNode }> = [];
    const topLevelFragments = new Set<string>();

    // First, identify which fragments are used at the top level (directly in items or in the main query)
    const queryDefs = clone.definitions.filter(isOperationDefinition);

    for (const queryDef of queryDefs) {
        const typeInfo = getOperationTypeInfo(queryDef);
        const fieldNode = queryDef.selectionSet.selections[0] as FieldNode;
        if (typeInfo && fieldNode?.selectionSet) {
            let topLevelSelectionSet: SelectionSetNode | undefined;

            // For paginated list queries, find the items field and add custom fields to its entity type
            if (typeInfo.isPaginatedList) {
                const itemsField = fieldNode.selectionSet.selections.find(
                    sel => sel.kind === 'Field' && sel.name.value === 'items',
                ) as FieldNode | undefined;

                if (itemsField?.selectionSet) {
                    // For paginated lists, the type is like "ProductList" but we need "Product"
                    const entityTypeName = typeInfo.type.replace(/List$/, '');
                    targetNodes.push({
                        typeName: entityTypeName,
                        selectionSet: itemsField.selectionSet,
                    });
                    topLevelSelectionSet = itemsField.selectionSet;
                }
            } else {
                // For single entity queries, add custom fields to the top-level entity
                targetNodes.push({
                    typeName: typeInfo.type,
                    selectionSet: fieldNode.selectionSet,
                });
                topLevelSelectionSet = fieldNode.selectionSet;
            }

            // Track which fragments are used at the top level (not in nested entities)
            if (topLevelSelectionSet) {
                for (const selection of topLevelSelectionSet.selections) {
                    if (selection.kind === Kind.FRAGMENT_SPREAD) {
                        topLevelFragments.add(selection.name.value);
                    }
                }
            }
        }
    }

    // Now add fragments
    const fragmentDefs = clone.definitions.filter(isFragmentDefinition);

    // Check if this document has query definitions - if not, add all fragments
    const hasQueries = queryDefs.length > 0;

    for (const fragmentDef of fragmentDefs) {
        if (hasQueries) {
            // If we have queries, add custom fields to:
            // 1. Fragments used at the top level (in the main query result)
            // 2. Fragments explicitly listed in includeNestedFragments option
            const isTopLevel = topLevelFragments.has(fragmentDef.name.value);
            const isExplicitlyIncluded = options?.includeNestedFragments?.includes(fragmentDef.name.value);

            if (isTopLevel || isExplicitlyIncluded) {
                targetNodes.push({
                    typeName: fragmentDef.typeCondition.name.value,
                    selectionSet: fragmentDef.selectionSet,
                });
            }
        } else {
            // For standalone fragments (no queries), add custom fields to all fragments
            // since we don't know where they'll be used
            targetNodes.push({
                typeName: fragmentDef.typeCondition.name.value,
                selectionSet: fragmentDef.selectionSet,
            });
        }
    }

    for (const target of targetNodes) {
        applyCustomFieldsToSelection(target.typeName, target.selectionSet, customFields, options);
    }

    // Cache the result before returning
    documentCache.set(optionsKey, clone);
    return clone;
}

function isFragmentDefinition(value: DefinitionNode): value is FragmentDefinitionNode {
    return value.kind === Kind.FRAGMENT_DEFINITION;
}

function isOperationDefinition(value: DefinitionNode): value is OperationDefinitionNode {
    return value.kind === Kind.OPERATION_DEFINITION;
}

function isFieldNode(value: SelectionNode): value is FieldNode {
    return value.kind === Kind.FIELD;
}
