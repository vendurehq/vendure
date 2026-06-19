import type { Rule } from 'eslint';

import { getCalleePropertyName, getMemberObjectText } from '../utils/ast';

function containsRawCtx(node: any): boolean {
    if (!node) {
        return false;
    }
    if (node.type === 'Identifier' && node.name === 'ctx') {
        return true;
    }
    if (node.type === 'ObjectExpression') {
        return node.properties?.some((property: any) => {
            return property.type === 'Property' && containsRawCtx(property.value);
        });
    }
    return false;
}

export const noRawRequestContextInJobData: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow passing raw RequestContext objects as job data',
            recommended: true,
        },
        messages: {
            noRawCtx:
                'Do not pass a raw RequestContext to JobQueue.add(). Use ctx.serialize() or pass only the required serializable fields.',
        },
        schema: [],
    },
    create(context) {
        return {
            CallExpression(node: any) {
                if (getCalleePropertyName(node) !== 'add') {
                    return;
                }
                const objectText = getMemberObjectText(context, node.callee).toLowerCase();
                if (!objectText.includes('queue')) {
                    return;
                }
                const dataArg = node.arguments[0];
                if (containsRawCtx(dataArg)) {
                    context.report({ node: dataArg, messageId: 'noRawCtx' });
                }
            },
        };
    },
};
