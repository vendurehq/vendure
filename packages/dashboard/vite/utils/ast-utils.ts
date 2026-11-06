import type { Node, SourceFile } from 'typescript/ast';
import { SyntaxKind } from 'typescript/ast';
import { isIdentifier, isTypeReferenceNode, isVariableStatement } from 'typescript/ast/is';

/**
 * Given the AST of a TypeScript file, finds the name of the variable exported as VendureConfig.
 */
export function findConfigExport(sourceFile: SourceFile): string | undefined {
    let exportedSymbolName: string | undefined;

    function visit(node: Node) {
        if (isVariableStatement(node) && node.modifiers?.some(m => m.kind === SyntaxKind.ExportKeyword)) {
            node.declarationList.declarations.forEach(declaration => {
                const typeNode = declaration.type;
                if (typeNode && isTypeReferenceNode(typeNode)) {
                    const typeName = typeNode.typeName;
                    if (isIdentifier(typeName) && typeName.text === 'VendureConfig') {
                        if (isIdentifier(declaration.name)) {
                            exportedSymbolName = declaration.name.text;
                        }
                    }
                }
            });
        }
        node.forEachChild(visit);
    }

    visit(sourceFile);
    return exportedSymbolName;
}
