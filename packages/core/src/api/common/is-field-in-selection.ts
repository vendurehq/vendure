import { FieldNode, GraphQLResolveInfo, SelectionNode } from 'graphql';

/**
 * Checks if a specific field is requested in the GraphQL query selection set.
 * Looks for the field within the 'items' selection of a paginated list.
 * A path of parent field names can be given to look deeper, e.g. `['items', 'children']`.
 * Supports direct field selections, fragment spreads, and inline fragments.
 */
export function isFieldInSelection(
    info: GraphQLResolveInfo,
    fieldName: string,
    parentFieldName: string | string[] = 'items',
): boolean {
    let selections: readonly SelectionNode[] = info.fieldNodes.flatMap(
        node => node.selectionSet?.selections ?? [],
    );
    for (const name of Array.isArray(parentFieldName) ? parentFieldName : [parentFieldName]) {
        selections = findFieldInSelections(selections, name, info)?.selectionSet?.selections ?? [];
    }
    return hasFieldInSelections(selections, fieldName, info);
}

/**
 * Finds a field by name in selections, including fragment spreads and inline fragments.
 */
function findFieldInSelections(
    selections: readonly SelectionNode[],
    fieldName: string,
    info: GraphQLResolveInfo,
): FieldNode | undefined {
    for (const selection of selections) {
        if (selection.kind === 'Field' && selection.name.value === fieldName) {
            return selection;
        }
        if (selection.kind === 'FragmentSpread') {
            const fragment = info.fragments[selection.name.value];
            if (fragment) {
                const found = findFieldInSelections(fragment.selectionSet.selections, fieldName, info);
                if (found) {
                    return found;
                }
            }
        }
        if (selection.kind === 'InlineFragment') {
            const found = findFieldInSelections(selection.selectionSet.selections, fieldName, info);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

/**
 * Checks if a field exists in selections, including fragment spreads and inline fragments.
 */
function hasFieldInSelections(
    selections: readonly SelectionNode[],
    fieldName: string,
    info: GraphQLResolveInfo,
): boolean {
    for (const selection of selections) {
        if (selection.kind === 'Field' && selection.name.value === fieldName) {
            return true;
        }
        if (selection.kind === 'FragmentSpread') {
            const fragment = info.fragments[selection.name.value];
            if (fragment && hasFieldInSelections(fragment.selectionSet.selections, fieldName, info)) {
                return true;
            }
        }
        if (selection.kind === 'InlineFragment') {
            if (hasFieldInSelections(selection.selectionSet.selections, fieldName, info)) {
                return true;
            }
        }
    }
    return false;
}
