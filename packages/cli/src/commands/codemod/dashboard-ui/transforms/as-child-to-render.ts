import { log } from '@clack/prompts';
import { JsxAttribute, JsxElement, JsxSelfClosingElement, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Transforms `asChild` prop pattern to `render` prop pattern.
 *
 * BEFORE:
 * ```
 * <Button asChild>
 *     <Link to="./new">
 *         <PlusIcon />
 *         New
 *     </Link>
 * </Button>
 * ```
 *
 * AFTER:
 * ```
 * <Button render={<Link to="./new" />}>
 *     <PlusIcon />
 *     New
 * </Button>
 * ```
 */
export function transformAsChildToRender(sourceFile: SourceFile): number {
    let changeCount = 0;

    // Process iteratively since each replacement invalidates AST positions.
    // We re-scan from scratch after each successful transform.
    let foundOne = true;
    while (foundOne) {
        foundOne = false;

        const allAsChildAttrs = sourceFile
            .getDescendantsOfKind(SyntaxKind.JsxAttribute)
            .filter(attr => attr.getNameNode().getText() === 'asChild');

        if (allAsChildAttrs.length === 0) {
            break;
        }

        for (const asChildAttr of allAsChildAttrs) {
            // JsxAttribute → JsxAttributes → JsxOpeningElement
            const jsxAttributes = asChildAttr.getParent();
            const openingElement = jsxAttributes?.getParentIfKind(SyntaxKind.JsxOpeningElement);
            if (!openingElement) {
                // asChild on a self-closing element — remove it and warn
                log.warn(
                    `${sourceFile.getFilePath()}:${asChildAttr.getStartLineNumber()} — ` +
                        `asChild on a non-opening element, removing attribute only`,
                );
                asChildAttr.remove();
                changeCount++;
                foundOne = true;
                break;
            }

            const parentJsxElement = openingElement.getParentIfKind(SyntaxKind.JsxElement);
            if (!parentJsxElement) {
                continue;
            }

            // Get the JSX children (skip whitespace-only text nodes)
            const jsxChildren = parentJsxElement.getJsxChildren().filter(c => {
                if (c.getKind() === SyntaxKind.JsxText) {
                    return c.getText().trim().length > 0;
                }
                return true;
            });

            if (jsxChildren.length !== 1) {
                // asChild expects exactly one child — warn and skip this occurrence
                log.warn(
                    `${sourceFile.getFilePath()}:${asChildAttr.getStartLineNumber()} — ` +
                        `asChild with ${jsxChildren.length} children, skipping (expected exactly 1)`,
                );
                continue;
            }

            const childNode = jsxChildren[0];
            const childIsElement = childNode.getKind() === SyntaxKind.JsxElement;
            const childIsSelfClosing = childNode.getKind() === SyntaxKind.JsxSelfClosingElement;

            if (!childIsElement && !childIsSelfClosing) {
                // Child is a JSX expression or text — can't auto-convert
                log.warn(
                    `${sourceFile.getFilePath()}:${asChildAttr.getStartLineNumber()} — ` +
                        `asChild wraps a non-element child, skipping`,
                );
                continue;
            }

            // Extract child tag name and props
            let childTagName: string;
            let childPropsText: string;
            let grandchildrenText: string;

            if (childIsElement) {
                const childEl = childNode as JsxElement;
                const childOpening = childEl.getOpeningElement();
                childTagName = childOpening.getTagNameNode().getText();
                childPropsText = childOpening
                    .getAttributes()
                    .map(a => a.getText())
                    .join(' ');
                // Use raw source text to preserve inline whitespace between JSX children
                // (e.g. `{value.firstName} {value.lastName}` — the space would be lost
                // if we relied on getJsxChildren().map(c => c.getText()).join(''))
                const innerStart = childOpening.getEnd();
                const closingElement = childEl.getClosingElement();
                const innerEnd = closingElement.getStart();
                const rawInner = sourceFile.getFullText().substring(innerStart, innerEnd);
                const childIndent = getLineIndent(sourceFile, childOpening.getStartLineNumber());
                grandchildrenText = childIndent > 0 ? dedentText(rawInner, childIndent) : rawInner;
            } else {
                const childEl = childNode as JsxSelfClosingElement;
                childTagName = childEl.getTagNameNode().getText();
                childPropsText = childEl
                    .getAttributes()
                    .map(a => a.getText())
                    .join(' ');
                grandchildrenText = '';
            }

            // Build render prop value: <ChildTag ...props />
            const renderValue = childPropsText
                ? `<${childTagName} ${childPropsText} />`
                : `<${childTagName} />`;

            // Build new parent opening tag (remove asChild, add render prop)
            const parentTagName = openingElement.getTagNameNode().getText();
            const parentAttrs = openingElement
                .getAttributes()
                .filter(a => {
                    if (a.getKind() === SyntaxKind.JsxAttribute) {
                        return (a as JsxAttribute).getNameNode().getText() !== 'asChild';
                    }
                    return true;
                })
                .map(a => a.getText());

            parentAttrs.push(`render={${renderValue}}`);
            const attrsStr = parentAttrs.join(' ');

            let replacement: string;
            if (grandchildrenText.trim()) {
                replacement = `<${parentTagName} ${attrsStr}>${grandchildrenText}</${parentTagName}>`;
            } else {
                replacement = `<${parentTagName} ${attrsStr} />`;
            }

            parentJsxElement.replaceWithText(replacement);
            changeCount++;
            foundOne = true;
            // Break inner loop to re-scan (positions invalidated)
            break;
        }
    }

    return changeCount;
}

function getLineIndent(sourceFile: SourceFile, lineNumber: number): number {
    const lineText = sourceFile.getFullText().split('\n')[lineNumber - 1] ?? '';
    const match = lineText.match(/^(\s*)/);
    return match ? match[1].length : 0;
}

function dedentText(text: string, amount: number): string {
    const regex = new RegExp(`^ {1,${amount}}`, 'gm');
    return text.replace(regex, '');
}
