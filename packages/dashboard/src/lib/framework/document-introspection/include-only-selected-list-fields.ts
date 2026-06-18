import {
    ArgumentNode,
    DocumentNode,
    FieldNode,
    FragmentDefinitionNode,
    FragmentSpreadNode,
    Kind,
    SelectionNode,
    VariableNode,
    visit,
} from 'graphql';

import { getQueryName } from './get-document-structure.js';

// Simple LRU-style cache for memoization
const filterCache = new Map<string, DocumentNode>();
const MAX_CACHE_SIZE = 100;

// Fast document fingerprinting using WeakMap for reference tracking
const documentIds = new WeakMap<DocumentNode, string>();
let documentCounter = 0;

/**
 * Get a fast, stable ID for a document node
 */
function getDocumentId(document: DocumentNode): string {
    let id = documentIds.get(document);
    if (!id) {
        // For new documents, create a lightweight structural hash
        id = createDocumentFingerprint(document);
        documentIds.set(document, id);
    }
    return id;
}

/**
 * Create a lightweight fingerprint of document structure (much faster than print())
 */
function createDocumentFingerprint(document: DocumentNode): string {
    const parts: string[] = [];

    for (const def of document.definitions) {
        if (def.kind === Kind.OPERATION_DEFINITION) {
            parts.push(`op:${def.operation}:${def.name?.value || 'anon'}`);
            // Just count selections, don't traverse them
            parts.push(`sel:${def.selectionSet.selections.length}`);
        } else if (def.kind === Kind.FRAGMENT_DEFINITION) {
            parts.push(`frag:${def.name.value}:${def.typeCondition.name.value}`);
            parts.push(`sel:${def.selectionSet.selections.length}`);
        }
    }

    return `doc_${++documentCounter}_${parts.join('_')}`;
}

/**
 * Create a stable cache key from document and selected columns
 */
function createCacheKey(
    document: DocumentNode,
    selectedColumns: Array<{ name: string; isCustomField: boolean; dependencies?: string[] }>,
): string {
    const docId = getDocumentId(document);
    const columnsKey = sortJoin(
        selectedColumns.map(col => {
            const deps = col.dependencies ? sortJoin(col.dependencies, '+') : '';
            const depsPart = deps ? `:deps(${deps})` : '';
            return `${col.name}:${String(col.isCustomField)}${depsPart}`;
        }),
        ',',
    );
    return `${docId}|${columnsKey}`;
}

function sortJoin<T>(arr: T[], separator: string): string {
    return arr.slice(0).sort().join(separator);
}

/**
 * @description
 * This function takes a list query document such as:
 * ```gql
 * query ProductList($options: ProductListOptions) {
 *     products(options: $options) {
 *         items {
 *             id
 *             createdAt
 *             updatedAt
 *             featuredAsset {
 *                 id
 *                 preview
 *             }
 *             name
 *             slug
 *             enabled
 *         }
 *         totalItems
 *     }
 * }
 * ```
 * and an array of selected columns, and returns a new document which only selects the
 * specified columns. So if `selectedColumns` equals `[{ name: 'id', isCustomField: false }]`,
 * then the resulting document's `items` fields would be `{ id }`.
 *
 * Columns can also declare dependencies on other fields that are required for rendering
 * but not necessarily visible. For example:
 * ```js
 * selectedColumns = [{
 *   name: 'name',
 *   isCustomField: false,
 *   dependencies: ['children', 'breadcrumbs'] // Always include these fields
 * }]
 * ```
 * This ensures that cell renderers can safely access dependent fields even when they're
 * not part of the visible column set.
 *
 * @param listQuery The GraphQL document to filter
 * @param selectedColumns Array of column definitions with optional dependencies
 */
export function includeOnlySelectedListFields<T extends DocumentNode>(
    listQuery: T,
    selectedColumns: Array<{
        name: string;
        isCustomField: boolean;
        dependencies?: string[];
    }>,
): T {
    // If no columns selected, return the original document
    if (selectedColumns.length === 0) {
        return listQuery;
    }

    // Check cache first
    const cacheKey = createCacheKey(listQuery, selectedColumns);
    if (filterCache.has(cacheKey)) {
        return filterCache.get(cacheKey) as T;
    }

    // Get the query name to identify the main list query field
    const queryName = getQueryName(listQuery);

    // Collect all required fields including dependencies
    const allRequiredFields = new Set<string>();
    const customFieldNames = new Set<string>();

    selectedColumns.forEach(col => {
        allRequiredFields.add(col.name);
        if (col.isCustomField) {
            customFieldNames.add(col.name);
        }
        // Add dependencies
        col.dependencies?.forEach(dep => {
            allRequiredFields.add(dep);
            // Note: Dependencies are assumed to be regular fields unless they start with custom field patterns
        });
    });

    const selectedFieldNames = allRequiredFields;

    // Collect all fragments from the document
    const fragments = collectFragments(listQuery);

    // First pass: identify which fragments are directly used by the items field
    const itemsFragments = getItemsFragments(listQuery, queryName);

    // Visit and transform the document
    const modifiedDocument = visit(listQuery, {
        [Kind.FIELD]: {
            enter(node: FieldNode, key, parent, path, ancestors): FieldNode | undefined {
                // Check if we're at the query root field (e.g., "products")
                const isQueryRoot =
                    ancestors.some(
                        ancestor =>
                            ancestor &&
                            typeof ancestor === 'object' &&
                            'kind' in ancestor &&
                            ancestor.kind === Kind.OPERATION_DEFINITION &&
                            ancestor.operation === 'query',
                    ) && node.name.value === queryName;

                if (!isQueryRoot) {
                    return undefined;
                }

                // Look for the "items" field within the query root
                if (node.selectionSet) {
                    const modifiedSelections = node.selectionSet.selections.map(selection => {
                        if (isFieldWithName(selection, 'items')) {
                            // Filter the items field to only include selected columns
                            return filterItemsField(
                                selection,
                                selectedFieldNames,
                                customFieldNames,
                                fragments,
                            );
                        }
                        return selection;
                    });

                    return {
                        ...node,
                        selectionSet: {
                            ...node.selectionSet,
                            selections: modifiedSelections,
                        },
                    };
                }

                return undefined;
            },
        },
        [Kind.FRAGMENT_DEFINITION]: {
            enter(node: FragmentDefinitionNode): FragmentDefinitionNode {
                // Only filter fragments that are directly used by the items field
                if (itemsFragments.has(node.name.value)) {
                    return filterFragment(node, selectedFieldNames, customFieldNames, fragments);
                }
                // Leave other fragments untouched
                return node;
            },
        },
    });

    // Remove unused fragments to prevent GraphQL validation errors
    const withoutUnusedFragments = removeUnusedFragments(modifiedDocument);

    // Remove unused variables to prevent GraphQL validation errors
    const result = removeUnusedVariables(withoutUnusedFragments);

    // Cache the result with LRU eviction
    if (filterCache.size >= MAX_CACHE_SIZE) {
        const firstKey = filterCache.keys().next().value;
        if (firstKey) {
            filterCache.delete(firstKey);
        }
    }
    filterCache.set(cacheKey, result);
    return result;
}

/**
 * Collect all fragments from the document
 */
function collectFragments(document: DocumentNode): Record<string, FragmentDefinitionNode> {
    const fragments: Record<string, FragmentDefinitionNode> = {};
    for (const definition of document.definitions) {
        if (definition.kind === Kind.FRAGMENT_DEFINITION) {
            fragments[definition.name.value] = definition;
        }
    }
    return fragments;
}

/**
 * Check if a selection is a field with the given name
 */
function isFieldWithName(selection: SelectionNode, fieldName: string): selection is FieldNode {
    return selection.kind === Kind.FIELD && selection.name.value === fieldName;
}

/**
 * Check if a selection is a field with the given name and has a selection set
 */
function isFieldWithNameAndSelections(selection: SelectionNode, fieldName: string): selection is FieldNode {
    return isFieldWithName(selection, fieldName) && !!selection.selectionSet;
}

/**
 * Collect fragment spreads from a selection set
 */
function collectFragmentSpreads(selections: readonly SelectionNode[]): string[] {
    const fragmentNames: string[] = [];
    for (const selection of selections) {
        if (selection.kind === Kind.FRAGMENT_SPREAD) {
            fragmentNames.push(selection.name.value);
        }
    }
    return fragmentNames;
}

/**
 * Check if a selection is a field node
 */
function isField(selection: SelectionNode): selection is FieldNode {
    return selection.kind === Kind.FIELD;
}

/**
 * Find the items field within a query field's selections
 */
function findItemsFieldFragments(querySelections: readonly SelectionNode[]): string[] {
    for (const selection of querySelections) {
        if (isFieldWithNameAndSelections(selection, 'items') && selection.selectionSet) {
            return collectFragmentSpreads(selection.selectionSet.selections);
        }
    }
    return [];
}

/**
 * Find the query field with the given name and process its items field
 */
function findQueryFieldFragments(selections: readonly SelectionNode[], queryName: string): string[] {
    for (const selection of selections) {
        if (isFieldWithNameAndSelections(selection, queryName) && selection.selectionSet) {
            return findItemsFieldFragments(selection.selectionSet.selections);
        }
    }
    return [];
}

/**
 * Get fragments that are directly used by the items field (not nested fragments)
 */
function getItemsFragments(document: DocumentNode, queryName: string): Set<string> {
    const itemsFragments = new Set<string>();

    for (const definition of document.definitions) {
        if (definition.kind === Kind.OPERATION_DEFINITION && definition.operation === 'query') {
            const fragmentNames = findQueryFieldFragments(definition.selectionSet.selections, queryName);
            fragmentNames.forEach(name => itemsFragments.add(name));
        }
    }

    return itemsFragments;
}

/**
 * Context for filtering field selections
 */
interface FieldSelectionContext {
    itemsField: FieldNode;
    availableFields: Map<string, SelectionNode>;
    fragmentSpreads: Map<string, FragmentSpreadNode>;
    fragments: Record<string, FragmentDefinitionNode>;
    neededFragments: Set<string>;
    filteredSelections: SelectionNode[];
}

/**
 * Check if a field is selected directly in the items field (not from a fragment)
 */
function isDirectField(fieldName: string, itemsField: FieldNode): boolean {
    if (!itemsField.selectionSet) return false;
    return itemsField.selectionSet.selections.some(sel => isFieldWithName(sel, fieldName));
}

/**
 * Add a regular field to filtered selections
 */
function addRegularField(fieldName: string, context: FieldSelectionContext): void {
    if (!context.availableFields.has(fieldName)) return;

    if (isDirectField(fieldName, context.itemsField)) {
        const fieldSelection = context.availableFields.get(fieldName);
        if (fieldSelection) {
            context.filteredSelections.push(fieldSelection);
        }
    } else {
        // Field comes from a fragment - mark fragments as needed
        for (const [fragName] of context.fragmentSpreads) {
            const fragment = context.fragments[fragName];
            if (fragment && fragmentContainsField(fragment, fieldName, context.fragments)) {
                context.neededFragments.add(fragName);
            }
        }
    }
}

/**
 * Add custom fields to filtered selections
 */
function addCustomFields(customFieldNames: Set<string>, context: FieldSelectionContext): void {
    if (customFieldNames.size === 0 || !context.availableFields.has('customFields')) return;

    if (isDirectField('customFields', context.itemsField)) {
        const customFieldsSelection = context.availableFields.get('customFields');
        if (customFieldsSelection && customFieldsSelection.kind === Kind.FIELD) {
            const filteredCustomFields = filterCustomFields(customFieldsSelection, customFieldNames);
            if (filteredCustomFields) {
                context.filteredSelections.push(filteredCustomFields);
            }
        }
    } else {
        // customFields comes from a fragment
        for (const [fragName] of context.fragmentSpreads) {
            const fragment = context.fragments[fragName];
            if (fragment && fragmentContainsField(fragment, 'customFields', context.fragments)) {
                context.neededFragments.add(fragName);
            }
        }
    }
}

/**
 * Check if context has only __typename as a field (which doesn't count as valid content)
 */
function hasOnlyTypenameField(context: FieldSelectionContext): boolean {
    return (
        context.filteredSelections.length === 1 &&
        isFieldWithName(context.filteredSelections[0], '__typename')
    );
}

/**
 * Check if context has valid fields that make the query meaningful
 */
function hasValidFields(context: FieldSelectionContext): boolean {
    return context.filteredSelections.length > 0 && !hasOnlyTypenameField(context);
}

/**
 * Add id field directly from available fields
 */
function addDirectIdField(context: FieldSelectionContext): void {
    const idField = context.availableFields.get('id');
    if (idField) {
        context.filteredSelections.push(idField);
    }
}

/**
 * Add id field from a fragment that contains it
 */
function addIdFieldFromFragment(context: FieldSelectionContext): void {
    for (const [fragName] of context.fragmentSpreads) {
        const fragment = context.fragments[fragName];
        if (fragment && fragmentContainsField(fragment, 'id', context.fragments)) {
            const fragmentSpread = context.fragmentSpreads.get(fragName);
            if (fragmentSpread) {
                context.filteredSelections.push(fragmentSpread);
            }
            break;
        }
    }
}

/**
 * Create a minimal id field when none exists
 */
function createMinimalIdField(context: FieldSelectionContext): void {
    context.filteredSelections.push({
        kind: Kind.FIELD,
        name: { kind: Kind.NAME, value: 'id' },
    });
}

/**
 * Ensure at least id field is included to maintain valid query
 */
function ensureIdField(context: FieldSelectionContext): void {
    if (hasValidFields(context)) return;

    if (context.availableFields.has('id')) {
        if (isDirectField('id', context.itemsField)) {
            addDirectIdField(context);
        } else {
            addIdFieldFromFragment(context);
        }
    } else {
        createMinimalIdField(context);
    }
}

/**
 * Initialize field selection context
 */
function initializeFieldSelectionContext(
    itemsField: FieldNode,
    fragments: Record<string, FragmentDefinitionNode>,
): FieldSelectionContext {
    return {
        itemsField,
        availableFields: new Map(),
        fragmentSpreads: new Map(),
        fragments,
        neededFragments: new Set(),
        filteredSelections: [],
    };
}

/**
 * Collect available fields and fragment spreads from selections
 */
function collectAvailableSelections(
    context: FieldSelectionContext,
    selections: readonly SelectionNode[],
    fragments: Record<string, FragmentDefinitionNode>,
): void {
    for (const selection of selections) {
        if (isField(selection)) {
            context.availableFields.set(selection.name.value, selection);
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
            context.fragmentSpreads.set(selection.name.value, selection);
            const fragment = fragments[selection.name.value];
            if (fragment) {
                collectFieldsFromFragment(fragment, fragments, context.availableFields);
            }
        }
    }
}

/**
 * Add __typename field if it exists in original selections
 */
function addTypenameField(context: FieldSelectionContext): void {
    if (context.availableFields.has('__typename')) {
        const typenameField = context.availableFields.get('__typename');
        if (typenameField) {
            context.filteredSelections.push(typenameField);
        }
    }
}

/**
 * Add all selected regular fields
 */
function addSelectedFields(context: FieldSelectionContext, selectedFieldNames: Set<string>): void {
    for (const fieldName of selectedFieldNames) {
        if (fieldName === '__typename') continue;
        addRegularField(fieldName, context);
    }
}

/**
 * Add needed fragment spreads to filtered selections
 */
function addNeededFragmentSpreads(context: FieldSelectionContext): void {
    for (const fragName of context.neededFragments) {
        const fragmentSpread = context.fragmentSpreads.get(fragName);
        if (fragmentSpread) {
            context.filteredSelections.push(fragmentSpread);
        }
    }
}

/**
 * Add inline fragments from original selections
 */
function addInlineFragments(context: FieldSelectionContext, selections: readonly SelectionNode[]): void {
    for (const selection of selections) {
        if (selection.kind === Kind.INLINE_FRAGMENT) {
            context.filteredSelections.push(selection);
        }
    }
}

/**
 * Filter the items field to only include selected columns
 */
function filterItemsField(
    itemsField: FieldNode,
    selectedFieldNames: Set<string>,
    customFieldNames: Set<string>,
    fragments: Record<string, FragmentDefinitionNode>,
): FieldNode {
    if (!itemsField.selectionSet) {
        return itemsField;
    }

    const context = initializeFieldSelectionContext(itemsField, fragments);

    collectAvailableSelections(context, itemsField.selectionSet.selections, fragments);
    addTypenameField(context);
    addSelectedFields(context, selectedFieldNames);
    addCustomFields(customFieldNames, context);
    addNeededFragmentSpreads(context);
    addInlineFragments(context, itemsField.selectionSet.selections);
    ensureIdField(context);

    return {
        ...itemsField,
        selectionSet: {
            ...itemsField.selectionSet,
            selections: context.filteredSelections,
        },
    };
}

/**
 * Collect all fields from a fragment recursively
 */
function collectFieldsFromFragment(
    fragment: FragmentDefinitionNode,
    fragments: Record<string, FragmentDefinitionNode>,
    availableFields: Map<string, SelectionNode>,
): void {
    for (const selection of fragment.selectionSet.selections) {
        if (isField(selection)) {
            availableFields.set(selection.name.value, selection);
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
            const nestedFragment = fragments[selection.name.value];
            if (nestedFragment) {
                collectFieldsFromFragment(nestedFragment, fragments, availableFields);
            }
        }
    }
}

/**
 * Check if a fragment contains a specific field
 */
function fragmentContainsField(
    fragment: FragmentDefinitionNode,
    fieldName: string,
    fragments: Record<string, FragmentDefinitionNode>,
): boolean {
    for (const selection of fragment.selectionSet.selections) {
        if (isFieldWithName(selection, fieldName)) {
            return true;
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
            const nestedFragment = fragments[selection.name.value];
            if (nestedFragment && fragmentContainsField(nestedFragment, fieldName, fragments)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Process a field selection for fragment filtering
 */
function processFragmentFieldSelection(
    selection: FieldNode,
    selectedFieldNames: Set<string>,
    customFieldNames: Set<string>,
    filteredSelections: SelectionNode[],
): void {
    const fieldName = selection.name.value;

    if (fieldName === '__typename') {
        filteredSelections.push(selection);
    } else if (selectedFieldNames.has(fieldName)) {
        filteredSelections.push(selection);
    } else if (fieldName === 'customFields' && customFieldNames.size > 0) {
        const filteredCustomFields = filterCustomFields(selection, customFieldNames);
        if (filteredCustomFields) {
            filteredSelections.push(filteredCustomFields);
        }
    }
}

/**
 * Check if a fragment spread contains any selected fields
 */
function fragmentSpreadContainsSelectedFields(
    spreadFragment: FragmentDefinitionNode,
    selectedFieldNames: Set<string>,
    fragments: Record<string, FragmentDefinitionNode>,
): boolean {
    for (const fieldName of selectedFieldNames) {
        if (fragmentContainsField(spreadFragment, fieldName, fragments)) {
            return true;
        }
    }
    return false;
}

/**
 * Process a fragment spread selection for fragment filtering
 */
function processFragmentSpreadSelection(
    selection: FragmentSpreadNode,
    selectedFieldNames: Set<string>,
    fragments: Record<string, FragmentDefinitionNode>,
    filteredSelections: SelectionNode[],
): void {
    const spreadFragment = fragments[selection.name.value];
    if (
        spreadFragment &&
        fragmentSpreadContainsSelectedFields(spreadFragment, selectedFieldNames, fragments)
    ) {
        filteredSelections.push(selection);
    }
}

/**
 * Process all selections in a fragment
 */
function processFragmentSelections(
    selections: readonly SelectionNode[],
    selectedFieldNames: Set<string>,
    customFieldNames: Set<string>,
    fragments: Record<string, FragmentDefinitionNode>,
): SelectionNode[] {
    const filteredSelections: SelectionNode[] = [];

    for (const selection of selections) {
        if (isField(selection)) {
            processFragmentFieldSelection(
                selection,
                selectedFieldNames,
                customFieldNames,
                filteredSelections,
            );
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
            processFragmentSpreadSelection(selection, selectedFieldNames, fragments, filteredSelections);
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
            // Keep inline fragments for now - more complex filtering would need type info
            filteredSelections.push(selection);
        }
    }

    return filteredSelections;
}

/**
 * Ensure fragment has at least one field by adding id if available
 */
function ensureFragmentHasFields(
    filteredSelections: SelectionNode[],
    originalSelections: readonly SelectionNode[],
): void {
    if (filteredSelections.length === 0) {
        // Add id if it exists in the original fragment
        for (const selection of originalSelections) {
            if (isFieldWithName(selection, 'id')) {
                filteredSelections.push(selection);
                break;
            }
        }
    }
}

/**
 * Filter a fragment to only include selected fields
 */
function filterFragment(
    fragment: FragmentDefinitionNode,
    selectedFieldNames: Set<string>,
    customFieldNames: Set<string>,
    fragments: Record<string, FragmentDefinitionNode>,
): FragmentDefinitionNode {
    const filteredSelections = processFragmentSelections(
        fragment.selectionSet.selections,
        selectedFieldNames,
        customFieldNames,
        fragments,
    );

    ensureFragmentHasFields(filteredSelections, fragment.selectionSet.selections);

    return {
        ...fragment,
        selectionSet: {
            ...fragment.selectionSet,
            selections: filteredSelections,
        },
    };
}

/**
 * Filter the customFields selection to only include selected custom fields
 */
function filterCustomFields(customFieldsNode: FieldNode, customFieldNames: Set<string>): FieldNode | null {
    if (!customFieldsNode.selectionSet) {
        return customFieldsNode;
    }

    const filteredSelections = customFieldsNode.selectionSet.selections.filter(selection => {
        if (isField(selection)) {
            return customFieldNames.has(selection.name.value);
        }
        // Keep fragments as they might contain selected custom fields
        return true;
    });

    if (filteredSelections.length === 0) {
        return null;
    }

    return {
        ...customFieldsNode,
        selectionSet: {
            ...customFieldsNode.selectionSet,
            selections: filteredSelections,
        },
    };
}

/**
 * Remove unused fragments from the document to prevent GraphQL validation errors
 */
function removeUnusedFragments<T extends DocumentNode>(document: T): T {
    // First, collect all fragment names that are actually used in the document
    const usedFragments = new Set<string>();

    // Helper function to recursively find fragment spreads
    const findFragmentSpreads = (selections: readonly SelectionNode[]) => {
        for (const selection of selections) {
            if (selection.kind === Kind.FRAGMENT_SPREAD) {
                usedFragments.add(selection.name.value);
            } else if (selection.kind === Kind.INLINE_FRAGMENT && selection.selectionSet) {
                findFragmentSpreads(selection.selectionSet.selections);
            } else if (selection.kind === Kind.FIELD && selection.selectionSet) {
                findFragmentSpreads(selection.selectionSet.selections);
            }
        }
    };

    // Look through all operations to find used fragments
    for (const definition of document.definitions) {
        if (definition.kind === Kind.OPERATION_DEFINITION) {
            findFragmentSpreads(definition.selectionSet.selections);
        }
    }

    // Now we need to handle transitive dependencies - fragments that use other fragments
    let foundNewFragments = true;
    while (foundNewFragments) {
        foundNewFragments = false;
        for (const definition of document.definitions) {
            if (definition.kind === Kind.FRAGMENT_DEFINITION && usedFragments.has(definition.name.value)) {
                const previousSize = usedFragments.size;
                findFragmentSpreads(definition.selectionSet.selections);
                if (usedFragments.size > previousSize) {
                    foundNewFragments = true;
                }
            }
        }
    }

    // Filter out unused fragment definitions
    const filteredDefinitions = document.definitions.filter(definition => {
        if (definition.kind === Kind.FRAGMENT_DEFINITION) {
            return usedFragments.has(definition.name.value);
        }
        return true;
    });

    return {
        ...document,
        definitions: filteredDefinitions,
    } as T;
}

/**
 * Remove unused variables from the document to prevent GraphQL validation errors
 */
function removeUnusedVariables<T extends DocumentNode>(document: T): T {
    const collector = new VariableUsageCollector();
    const usedVariables = collector.collectFromDocument(document);

    // Filter out unused variable definitions from operations
    const modifiedDefinitions = document.definitions.map(definition => {
        if (definition.kind === Kind.OPERATION_DEFINITION && definition.variableDefinitions) {
            const filteredVariableDefinitions = definition.variableDefinitions.filter(variableDef =>
                usedVariables.has(variableDef.variable.name.value),
            );

            return {
                ...definition,
                variableDefinitions: filteredVariableDefinitions,
            };
        }
        return definition;
    });

    return {
        ...document,
        definitions: modifiedDefinitions,
    } as T;
}

/**
 * Variable usage collector that traverses GraphQL structures
 */
class VariableUsageCollector {
    private readonly usedVariables = new Set<string>();

    /**
     * Collect variables from a GraphQL value (recursive)
     */
    private collectFromValue(value: any): void {
        switch (value.kind) {
            case Kind.VARIABLE:
                this.usedVariables.add((value as VariableNode).name.value);
                break;
            case Kind.LIST:
                value.values.forEach((item: any) => this.collectFromValue(item));
                break;
            case Kind.OBJECT:
                value.fields.forEach((field: any) => this.collectFromValue(field.value));
                break;
            // For other value types (STRING, INT, FLOAT, BOOLEAN, NULL, ENUM), no variables to collect
        }
    }

    /**
     * Collect variables from field arguments
     */
    private collectFromArguments(args: readonly ArgumentNode[]): void {
        args.forEach(arg => this.collectFromValue(arg.value));
    }

    /**
     * Collect variables from selection set (recursive)
     */
    private collectFromSelections(selections: readonly SelectionNode[]): void {
        selections.forEach(selection => {
            switch (selection.kind) {
                case Kind.FIELD:
                    if (selection.arguments) {
                        this.collectFromArguments(selection.arguments);
                    }
                    if (selection.selectionSet) {
                        this.collectFromSelections(selection.selectionSet.selections);
                    }
                    break;
                case Kind.INLINE_FRAGMENT:
                    if (selection.selectionSet) {
                        this.collectFromSelections(selection.selectionSet.selections);
                    }
                    break;
                case Kind.FRAGMENT_SPREAD:
                    // Fragment spreads are handled when processing fragment definitions
                    break;
            }
        });
    }

    /**
     * Collect all used variables from a document
     */
    collectFromDocument(document: DocumentNode): Set<string> {
        this.usedVariables.clear();

        document.definitions.forEach(definition => {
            if (
                definition.kind === Kind.OPERATION_DEFINITION ||
                definition.kind === Kind.FRAGMENT_DEFINITION
            ) {
                this.collectFromSelections(definition.selectionSet.selections);
            }
        });

        return new Set(this.usedVariables);
    }
}
