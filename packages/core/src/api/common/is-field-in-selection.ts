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
        selections = findFieldsInSelections(selections, name, info).flatMap(
            field => field.selectionSet?.selections ?? [],
        );
    }
    return hasFieldInSelections(selections, fieldName, info);
}

/**
 * Finds all fields with the given name in selections, including fragment spreads and inline
 * fragments. A field may be selected more than once, in which case GraphQL merges the selections.
 */
function findFieldsInSelections(
    selections: readonly SelectionNode[],
    fieldName: string,
    info: GraphQLResolveInfo,
): FieldNode[] {
    return selections.flatMap(selection => {
        if (selection.kind === 'Field') {
            return selection.name.value === fieldName ? [selection] : [];
        }
        if (selection.kind === 'FragmentSpread') {
            const fragment = info.fragments[selection.name.value];
            return fragment ? findFieldsInSelections(fragment.selectionSet.selections, fieldName, info) : [];
        }
        return findFieldsInSelections(selection.selectionSet.selections, fieldName, info);
    });
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
