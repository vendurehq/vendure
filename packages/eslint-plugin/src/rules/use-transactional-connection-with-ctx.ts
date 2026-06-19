import type { Rule } from 'eslint';

import { functionHasParameterNamed, getCalleePropertyName, getNearestFunctionAncestors } from '../utils/ast';

export const useTransactionalConnectionWithCtx: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require RequestContext when using TransactionalConnection.getRepository',
            recommended: true,
        },
        messages: {
            missingCtx:
                'Pass the active RequestContext to TransactionalConnection.getRepository(ctx, Entity).',
        },
        schema: [],
    },
    create(context) {
        return {
            CallExpression(node: any) {
                if (getCalleePropertyName(node) !== 'getRepository') {
                    return;
                }
                if (node.arguments.length !== 1) {
                    return;
                }
                const hasVisibleCtx = getNearestFunctionAncestors(context, node).some(fn =>
                    functionHasParameterNamed(fn, 'ctx'),
                );
                if (!hasVisibleCtx) {
                    return;
                }
                context.report({ node: node.callee, messageId: 'missingCtx' });
            },
        };
    },
};
