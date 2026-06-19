import type { Rule } from 'eslint';

import { getClassVendurePluginDecorator, isInsideNode, isPropertyNamed } from '../utils/ast';

export const noStaticPluginOptionsOutsidePlugin: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow reading static plugin options outside the plugin class',
            recommended: true,
        },
        messages: {
            noStaticOptions:
                'Do not read static plugin options from services or resolvers. Inject the plugin options token instead.',
        },
        schema: [],
    },
    create(context) {
        const pluginClasses = new Map<string, any>();

        return {
            ClassDeclaration(node: any) {
                if (node.id?.name && getClassVendurePluginDecorator(node)) {
                    pluginClasses.set(node.id.name, node);
                }
            },
            'Program:exit'() {
                pluginClasses.clear();
            },
            MemberExpression(node: any) {
                if (
                    node.object?.type !== 'Identifier' ||
                    !isPropertyNamed(node.property, 'options') ||
                    !pluginClasses.has(node.object.name)
                ) {
                    return;
                }
                const pluginClass = pluginClasses.get(node.object.name);
                if (isInsideNode(context, node, pluginClass)) {
                    return;
                }
                context.report({ node, messageId: 'noStaticOptions' });
            },
        };
    },
};
