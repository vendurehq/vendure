import type { Rule } from 'eslint';

import { isBooleanLiteral, isPropertyNamed } from '../utils/ast';

export const noSynchronizeTrue: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow TypeORM synchronize: true in Vendure projects',
            recommended: true,
        },
        messages: {
            noSynchronizeTrue:
                'Do not use dbConnectionOptions.synchronize: true. Generate and run migrations instead.',
        },
        schema: [],
    },
    create(context) {
        return {
            Property(node: any) {
                if (isPropertyNamed(node.key, 'synchronize') && isBooleanLiteral(node.value, true)) {
                    context.report({ node: node.value, messageId: 'noSynchronizeTrue' });
                }
            },
        };
    },
};
