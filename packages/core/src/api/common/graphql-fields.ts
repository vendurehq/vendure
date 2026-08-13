import {
    ArgumentNode,
    FieldNode,
    FragmentDefinitionNode,
    GraphQLResolveInfo,
    InlineFragmentNode,
    SelectionNode,
} from 'graphql';

/**
 * Recursive map of selected GraphQL fields. Leaf fields map to an empty object;
 * fields with sub-selections map to the same shape nested.
 *
 * Example query: `{ user { id orders { code } } }` yields:
 * ```
 * { user: { id: {}, orders: { code: {} } } }
 * ```
 */
export type FieldTree = { [fieldName: string]: FieldTree };

/**
 * Walks a `GraphQLResolveInfo` and produces a nested object describing the
 * fields the client has selected on this resolver's return type.
 *
 * Vendored from `graphql-fields@2.0.3`:
 *   - Source: https://github.com/robrichard/graphql-fields
 *   - Copyright (c) 2016 Rob Richard
 *   - Licence: MIT (https://github.com/robrichard/graphql-fields/blob/master/LICENSE)
 *
 * Trimmed to the subset Vendure actually uses — the `processArguments` and
 * `excludedFields` options upstream supports are omitted because the single
 * call site (`@Relations()` decorator) never passes them.
 *
 * Supports:
 *   - direct field selections
 *   - inline fragments (`... on Type { ... }`)
 *   - named fragment spreads (`...FragmentName`)
 *   - `@skip(if: ...)` and `@include(if: ...)` directives, including those
 *     reading from `info.variableValues`
 *   - field merging when the same field appears multiple times across
 *     fragments (later occurrences extend earlier ones)
 */
export function graphqlFields(info: GraphQLResolveInfo): FieldTree {
    return info.fieldNodes.reduce<FieldTree>((tree, node) => flattenSelection(node, info, tree), {});
}

function flattenSelection(
    node: FieldNode | InlineFragmentNode | FragmentDefinitionNode,
    info: GraphQLResolveInfo,
    tree: FieldTree,
): FieldTree {
    const selections = node.selectionSet?.selections ?? [];
    for (const selection of selections) {
        if (!shouldInclude(selection, info)) {
            continue;
        }
        if (selection.kind === 'InlineFragment') {
            flattenSelection(selection, info, tree);
        } else if (selection.kind === 'FragmentSpread') {
            const fragment = info.fragments[selection.name.value];
            if (fragment) {
                flattenSelection(fragment, info, tree);
            }
        } else {
            const name = selection.name.value;
            const existing = tree[name];
            tree[name] = flattenSelection(selection, info, existing ?? {});
        }
    }
    return tree;
}

function shouldInclude(selection: SelectionNode, info: GraphQLResolveInfo): boolean {
    const directives = selection.directives;
    if (!directives || directives.length === 0) {
        return true;
    }
    for (const directive of directives) {
        const name = directive.name.value;
        if (name !== 'skip' && name !== 'include') {
            continue;
        }
        const arg = directive.arguments?.[0];
        if (!arg) {
            continue;
        }
        const condition = resolveBooleanArgument(arg, info);
        if (name === 'skip' && condition === true) return false;
        if (name === 'include' && condition === false) return false;
    }
    return true;
}

function resolveBooleanArgument(arg: ArgumentNode, info: GraphQLResolveInfo): boolean {
    if (arg.value.kind === 'BooleanValue') {
        return arg.value.value;
    }
    if (arg.value.kind === 'Variable') {
        return Boolean(info.variableValues[arg.value.name.value]);
    }
    // `@skip`/`@include` are spec-typed as `Boolean!`, so unreachable in any valid
    // query — but stay conservative: treat as false to leave fields visible by default.
    return false;
}
