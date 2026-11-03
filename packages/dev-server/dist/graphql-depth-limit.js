"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDepthLimitRule = createDepthLimitRule;
const graphql_1 = require("graphql");
function createDepthLimitRule(maxDepth) {
    return (context) => ({
        OperationDefinition(node) {
            const depth = selectionSetDepth(context, node.selectionSet, 1, new Set());
            if (depth > maxDepth) {
                context.reportError(new graphql_1.GraphQLError(`Query depth ${depth} exceeds the maximum allowed depth of ${maxDepth}.`, { nodes: node }));
            }
        },
    });
}
function selectionSetDepth(context, selectionSet, currentDepth, usedFragments) {
    let max = currentDepth;
    for (const selection of selectionSet.selections) {
        if (selection.kind === graphql_1.Kind.FIELD) {
            max = Math.max(max, selection.selectionSet
                ? selectionSetDepth(context, selection.selectionSet, currentDepth + 1, usedFragments)
                : currentDepth);
        }
        else if (selection.kind === graphql_1.Kind.INLINE_FRAGMENT) {
            max = Math.max(max, selectionSetDepth(context, selection.selectionSet, currentDepth, usedFragments));
        }
        else if (selection.kind === graphql_1.Kind.FRAGMENT_SPREAD) {
            const name = selection.name.value;
            if (usedFragments.has(name)) {
                continue;
            }
            const fragment = context.getFragment(name);
            if (fragment) {
                const nextUsed = new Set(usedFragments);
                nextUsed.add(name);
                max = Math.max(max, selectionSetDepth(context, fragment.selectionSet, currentDepth + 1, nextUsed));
            }
        }
    }
    return max;
}
