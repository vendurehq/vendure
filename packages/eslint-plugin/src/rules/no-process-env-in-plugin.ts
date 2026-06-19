import type { Rule } from 'eslint';

import { isMemberExpression } from '../utils/ast';

export const noProcessEnvInPlugin: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow direct process.env reads in Vendure plugin code',
            recommended: true,
        },
        messages: {
            noProcessEnv:
                'Do not read process.env inside Vendure plugin code. Read environment variables in vendure-config.ts and pass values through plugin init options.',
        },
        schema: [],
    },
    create(context) {
        return {
            MemberExpression(node: any) {
                if (isMemberExpression(node, 'process', 'env')) {
                    context.report({ node, messageId: 'noProcessEnv' });
                }
            },
        };
    },
};
