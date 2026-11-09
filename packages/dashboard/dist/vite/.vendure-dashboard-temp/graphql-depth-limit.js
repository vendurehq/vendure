"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDepthLimitRule = createDepthLimitRule;
const graphql_1 = require("graphql");
/**
 * 生成 GraphQL 查询深度上限校验规则。
 *
 * 作用：拒绝深度超过 maxDepth 的查询（含通过 fragment 嵌套绕过的场景），
 * 与复杂度上限（HardenPlugin）一起限制恶意深嵌套查询拖垮服务。
 */
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
                continue; // 循环 fragment 防护
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
