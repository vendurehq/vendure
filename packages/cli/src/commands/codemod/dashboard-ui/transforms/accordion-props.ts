import { SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Removes deprecated Accordion props that are no longer needed
 * in Base UI's Accordion component.
 *
 * Removes:
 * - `type="single"` / `type="multiple"` attributes
 * - `collapsible` boolean attribute
 *
 * BEFORE:
 * ```
 * <Accordion type="single" collapsible className="w-full">
 * ```
 *
 * AFTER:
 * ```
 * <Accordion className="w-full">
 * ```
 */
export function transformAccordionProps(sourceFile: SourceFile): number {
    let changeCount = 0;

    const jsxElements = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];

    // Process in reverse to avoid position shifts
    const accordionElements = jsxElements
        .filter(el => el.getTagNameNode().getText() === 'Accordion')
        .reverse();

    for (const element of accordionElements) {
        const attributes = element.getAttributes();

        for (const attr of [...attributes].reverse()) {
            if (attr.getKind() !== SyntaxKind.JsxAttribute) {
                continue;
            }

            const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute);
            if (!jsxAttr) {
                continue;
            }

            const name = jsxAttr.getNameNode().getText();

            if (name === 'type') {
                const initializer = jsxAttr.getInitializer();
                if (initializer) {
                    const text = initializer.getText();
                    if (
                        text === '"single"' ||
                        text === "'single'" ||
                        text === '"multiple"' ||
                        text === "'multiple'"
                    ) {
                        jsxAttr.remove();
                        changeCount++;
                    }
                }
            } else if (name === 'collapsible') {
                jsxAttr.remove();
                changeCount++;
            }
        }
    }

    return changeCount;
}
