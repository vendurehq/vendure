import type { Rule } from 'eslint';

type Node = any;

function getSourceCode(context: Rule.RuleContext): any {
    return (context as any).sourceCode ?? context.getSourceCode();
}

export function getAncestors(context: Rule.RuleContext, node: Node): Node[] {
    if (typeof (context as any).getAncestors === 'function') {
        return (context as any).getAncestors();
    }
    return getSourceCode(context).getAncestors(node);
}

export function getPropertyName(node: Node): string | undefined {
    if (!node) {
        return;
    }
    if (node.type === 'Identifier') {
        return node.name;
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
    }
}

export function isPropertyNamed(node: Node, name: string): boolean {
    return getPropertyName(node) === name;
}

export function isBooleanLiteral(node: Node, value: boolean): boolean {
    return node?.type === 'Literal' && node.value === value;
}

export function isMemberExpression(node: Node, objectName: string, propertyName: string): boolean {
    if (node?.type !== 'MemberExpression') {
        return false;
    }
    return (
        node.object?.type === 'Identifier' &&
        node.object.name === objectName &&
        isPropertyNamed(node.property, propertyName)
    );
}

export function isVendurePluginDecorator(node: Node): boolean {
    return (
        node?.type === 'Decorator' &&
        node.expression?.type === 'CallExpression' &&
        node.expression.callee?.type === 'Identifier' &&
        node.expression.callee.name === 'VendurePlugin'
    );
}

export function getDecoratorCall(node: Node): Node | undefined {
    return isVendurePluginDecorator(node) ? node.expression : undefined;
}

export function getClassVendurePluginDecorator(node: Node): Node | undefined {
    return node?.decorators?.find((decorator: Node) => isVendurePluginDecorator(decorator));
}

export function getObjectProperty(objectExpression: Node, propertyName: string): Node | undefined {
    if (objectExpression?.type !== 'ObjectExpression') {
        return;
    }
    return objectExpression.properties?.find((property: Node) => {
        return property?.type === 'Property' && isPropertyNamed(property.key, propertyName);
    });
}

export function getNearestFunctionAncestors(context: Rule.RuleContext, node: Node): Node[] {
    return getAncestors(context, node).filter((ancestor: Node) => {
        return (
            ancestor.type === 'FunctionDeclaration' ||
            ancestor.type === 'FunctionExpression' ||
            ancestor.type === 'ArrowFunctionExpression'
        );
    });
}

export function functionHasParameterNamed(fn: Node, parameterName: string): boolean {
    return fn?.params?.some((param: Node) => param.type === 'Identifier' && param.name === parameterName);
}

export function getEnclosingMethodName(context: Rule.RuleContext, node: Node): string | undefined {
    const ancestors = getAncestors(context, node);
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];
        if (ancestor.type === 'MethodDefinition' || ancestor.type === 'PropertyDefinition') {
            return getPropertyName(ancestor.key);
        }
    }
}

export function isInsideNode(context: Rule.RuleContext, node: Node, target: Node): boolean {
    return getAncestors(context, node).includes(target);
}

export function getCalleePropertyName(node: Node): string | undefined {
    if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') {
        return;
    }
    return getPropertyName(node.callee.property);
}

export function getMemberObjectText(context: Rule.RuleContext, node: Node): string {
    if (node?.type !== 'MemberExpression') {
        return '';
    }
    return getSourceCode(context).getText(node.object);
}
