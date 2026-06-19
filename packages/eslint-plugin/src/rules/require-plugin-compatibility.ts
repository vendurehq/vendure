import type { Rule } from 'eslint';

import { getDecoratorCall, getObjectProperty, isVendurePluginDecorator } from '../utils/ast';

export const requirePluginCompatibility: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require a compatibility declaration on Vendure plugins',
            recommended: true,
        },
        messages: {
            missingCompatibility:
                'Vendure plugins should declare a compatibility range, e.g. compatibility: "^3.0.0".',
        },
        schema: [],
    },
    create(context) {
        return {
            Decorator(node: any) {
                if (!isVendurePluginDecorator(node)) {
                    return;
                }
                const call = getDecoratorCall(node);
                const metadata = call?.arguments?.[0];
                if (metadata?.type !== 'ObjectExpression') {
                    return;
                }
                if (!getObjectProperty(metadata, 'compatibility')) {
                    context.report({ node: metadata, messageId: 'missingCompatibility' });
                }
            },
        };
    },
};
