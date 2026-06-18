import { log } from '@clack/prompts';
import { JsxElement, JsxOpeningElement, JsxSelfClosingElement, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Adds the `items` prop to `<Select>` elements that are missing it.
 *
 * For static `<SelectItem>` children with string value props and text content,
 * the items record is built automatically:
 *
 * BEFORE:
 * ```tsx
 * <Select value={value} onValueChange={setValue}>
 *     <SelectContent>
 *         <SelectItem value="draft">Draft</SelectItem>
 *         <SelectItem value="published">Published</SelectItem>
 *     </SelectContent>
 * </Select>
 * ```
 *
 * AFTER:
 * ```tsx
 * <Select value={value} onValueChange={setValue} items={{ draft: 'Draft', published: 'Published' }}>
 *     <SelectContent>
 *         <SelectItem value="draft">Draft</SelectItem>
 *         <SelectItem value="published">Published</SelectItem>
 *     </SelectContent>
 * </Select>
 * ```
 *
 * For dynamic patterns (e.g. `.map()` calls), a warning is logged instead.
 *
 * Returns the number of changes made.
 */
export function transformSelectItemsProp(sourceFile: SourceFile): number {
    let changeCount = 0;

    // Process one at a time since adding attributes invalidates positions
    let foundOne = true;
    while (foundOne) {
        foundOne = false;

        const selectElements = sourceFile
            .getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
            .filter(el => el.getTagNameNode().getText() === 'Select');

        for (const selectOpening of selectElements) {
            if (hasAttribute(selectOpening, 'items')) {
                continue;
            }

            const selectElement = selectOpening.getParentIfKind(SyntaxKind.JsxElement);
            if (!selectElement) {
                continue;
            }

            // Find all <SelectItem> descendants
            const selectItems = findSelectItems(selectElement);

            if (selectItems.length === 0) {
                // No static SelectItems found — could be dynamic (.map), warn
                const filePath = sourceFile.getFilePath();
                const line = selectOpening.getStartLineNumber();
                log.warn(
                    `${filePath}:${line} — <Select> is missing the "items" prop. ` +
                        `Could not find static <SelectItem> children to auto-generate it. ` +
                        `Please add it manually: items={{ value: 'Label', ... }}`,
                );
                continue;
            }

            // Extract value → label pairs from <SelectItem value="x">Label</SelectItem>
            const itemEntries: Array<{ value: string; label: string }> = [];
            let canAutoFix = true;

            for (const item of selectItems) {
                const valueProp = getStringAttributeValue(item.openingOrSelf, 'value');
                if (!valueProp) {
                    canAutoFix = false;
                    break;
                }

                const label = item.textContent;
                if (!label) {
                    canAutoFix = false;
                    break;
                }

                itemEntries.push({ value: valueProp, label });
            }

            if (!canAutoFix || itemEntries.length === 0) {
                const filePath = sourceFile.getFilePath();
                const line = selectOpening.getStartLineNumber();
                log.warn(
                    `${filePath}:${line} — <Select> is missing the "items" prop. ` +
                        `SelectItem values or labels are dynamic. ` +
                        `Please add it manually: items={{ value: 'Label', ... }}`,
                );
                continue;
            }

            // Build the items array: [{ label: 'Label', value: 'value' }, ...]
            const entries = itemEntries
                .map(({ value, label }) => `{ label: '${label}', value: '${value}' }`)
                .join(', ');
            const itemsProp = `items={[${entries}]}`;

            // Add the items prop to the Select opening tag
            const openingText = selectOpening.getText();
            // Insert before the closing > of the opening tag
            const insertPos = openingText.length - 1; // before >
            const newOpeningText =
                openingText.slice(0, insertPos) + ` ${itemsProp}` + openingText.slice(insertPos);

            // Replace the full opening element text
            selectOpening.replaceWithText(newOpeningText);
            changeCount++;
            foundOne = true;
            break; // Re-scan after modification
        }
    }

    // Also check self-closing <Select /> without items
    const selfClosingSelects = sourceFile
        .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
        .filter(el => el.getTagNameNode().getText() === 'Select' && !hasAttribute(el, 'items'));

    for (const el of selfClosingSelects) {
        const filePath = sourceFile.getFilePath();
        const line = el.getStartLineNumber();
        log.warn(
            `${filePath}:${line} — Self-closing <Select /> is missing the "items" prop. ` +
                `Please add it manually.`,
        );
    }

    return changeCount;
}

interface SelectItemInfo {
    openingOrSelf: JsxOpeningElement | JsxSelfClosingElement;
    textContent: string | undefined;
}

/**
 * Finds all <SelectItem> elements inside a <Select> and extracts their info.
 */
function findSelectItems(selectElement: JsxElement): SelectItemInfo[] {
    const items: SelectItemInfo[] = [];

    // Find <SelectItem> as JsxElement (with children)
    const jsxElements = selectElement.getDescendantsOfKind(SyntaxKind.JsxElement);
    for (const el of jsxElements) {
        const opening = el.getOpeningElement();
        if (opening.getTagNameNode().getText() !== 'SelectItem') {
            continue;
        }
        // Get text content — only plain text children, not JSX
        const children = el.getJsxChildren();
        const textParts: string[] = [];
        let hasOnlyText = true;

        for (const child of children) {
            if (child.getKind() === SyntaxKind.JsxText) {
                const trimmed = child.getText().trim();
                if (trimmed) {
                    textParts.push(trimmed);
                }
            } else {
                hasOnlyText = false;
            }
        }

        items.push({
            openingOrSelf: opening,
            textContent: hasOnlyText && textParts.length > 0 ? textParts.join(' ') : undefined,
        });
    }

    return items;
}

function hasAttribute(element: JsxOpeningElement | JsxSelfClosingElement, name: string): boolean {
    return element.getAttributes().some(attr => {
        if (attr.getKind() !== SyntaxKind.JsxAttribute) {
            return false;
        }
        return attr.asKind(SyntaxKind.JsxAttribute)?.getNameNode().getText() === name;
    });
}

/**
 * Gets the string value of a JSX attribute, if it's a static string literal.
 * Returns undefined for dynamic expressions.
 */
function getStringAttributeValue(
    element: JsxOpeningElement | JsxSelfClosingElement,
    name: string,
): string | undefined {
    const attr = element.getAttributes().find(a => {
        if (a.getKind() !== SyntaxKind.JsxAttribute) {
            return false;
        }
        return a.asKind(SyntaxKind.JsxAttribute)?.getNameNode().getText() === name;
    });

    if (!attr) {
        return undefined;
    }

    const jsxAttr = attr.asKind(SyntaxKind.JsxAttribute);
    const initializer = jsxAttr?.getInitializer();
    if (!initializer) {
        return undefined;
    }

    const text = initializer.getText();
    // Only handle string literals: "value" or 'value'
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }

    return undefined;
}
