import { FieldNode, GraphQLResolveInfo, SelectionNode } from 'graphql';

/**
 * Checks if a specific field is requested in the GraphQL query selection set.
 * Looks for the field within the 'items' selection of a paginated list.
 * Supports direct field selections, fragment spreads, and inline fragments.
 */
export function isFieldInSelection(
    info: GraphQLResolveInfo,
    fieldName: string,
    parentFieldName = 'items',
): boolean {
    const parentSelections = info.fieldNodes.flatMap(node => node.selectionSet?.selections ?? []);
    const parentField = findFieldInSelections(parentSelections, parentFieldName, info);
    const childSelections = parentField?.selectionSet?.selections ?? [];
    return hasFieldInSelections(childSelections, fieldName, info);
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
