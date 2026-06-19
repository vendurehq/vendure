import type { Rule } from 'eslint';

import { getCalleePropertyName, getEnclosingMethodName, getMemberObjectText } from '../utils/ast';

const lifecycleMethods = new Set(['onModuleInit', 'onApplicationBootstrap']);

export const requireJobQueueLifecycleRegistration: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require Vendure job queues to be created during a Nest lifecycle hook',
            recommended: true,
        },
        messages: {
            createInLifecycle:
                'Create Vendure job queues in onModuleInit() or onApplicationBootstrap(), then reuse the queue when adding jobs.',
        },
        schema: [],
    },
    create(context) {
        return {
            CallExpression(node: any) {
                if (getCalleePropertyName(node) !== 'createQueue') {
                    return;
                }
                const objectText = getMemberObjectText(context, node.callee).toLowerCase();
                if (!objectText.includes('jobqueueservice')) {
                    return;
                }
                const methodName = getEnclosingMethodName(context, node);
                if (methodName && lifecycleMethods.has(methodName)) {
                    return;
                }
                context.report({ node: node.callee, messageId: 'createInLifecycle' });
            },
        };
    },
};
