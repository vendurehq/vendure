import ts from 'typescript';

/**
 * Given the AST of a TypeScript file, finds the name of the variable exported as VendureConfig.
 */
export function findConfigExport(sourceFile: ts.SourceFile): string | undefined {
    let exportedSymbolName: string | undefined;

    function visit(node: ts.Node) {
        if (
            ts.isVariableStatement(node) &&
            node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
            node.declarationList.declarations.forEach(declaration => {
                if (ts.isVariableDeclaration(declaration)) {
                    const typeNode = declaration.type;
                    if (typeNode && ts.isTypeReferenceNode(typeNode)) {
                        const typeName = typeNode.typeName;
                        if (ts.isIdentifier(typeName) && typeName.text === 'VendureConfig') {
                            if (ts.isIdentifier(declaration.name)) {
                                exportedSymbolName = declaration.name.text;
                            }
                        }
                    }
                }
            });
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return exportedSymbolName;
}
