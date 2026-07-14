import { log } from '@clack/prompts';
import { JsxSelfClosingElement, SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Transforms old React Hook Form + shadcn FormField pattern to FormFieldWrapper.
 *
 * BEFORE:
 * ```
 * <FormField
 *     control={form.control}
 *     name="slug"
 *     render={({ field }) => (
 *         <FormItem>
 *             <FormLabel>Slug</FormLabel>
 *             <FormControl>
 *                 <Input {...field} />
 *             </FormControl>
 *             <FormDescription>The URL slug.</FormDescription>
 *             <FormMessage />
 *         </FormItem>
 *     )}
 * />
 * ```
 *
 * AFTER:
 * ```
 * <FormFieldWrapper
 *     control={form.control}
 *     name="slug"
 *     label="Slug"
 *     description="The URL slug."
 *     render={({ field }) => (
 *         <Input {...field} />
 *     )}
 * />
 * ```
 *
 * Uses ts-morph AST for reliable parsing. Falls back to a TODO comment
 * for patterns that can't be auto-converted.
 */
export function transformFormComponents(sourceFile: SourceFile): number {
    let changeCount = 0;
    const text = sourceFile.getFullText();

    if (!text.includes('<FormField')) {
        return 0;
    }

    // Process one FormField at a time, re-querying after each modification
    // because insertText/replaceWithText invalidates AST node references.
    const maxIterations = 100;
    for (let i = 0; i < maxIterations; i++) {
        const formField = sourceFile
            .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
            .find(el => el.getTagNameNode().getText() === 'FormField');

        if (!formField) {
            break;
        }
        // Extract control and name props
        const controlAttr = getJsxAttributeValue(formField, 'control');
        const nameAttr = getJsxAttributeValue(formField, 'name');

        // Extract the render prop's arrow function body
        const renderAttr = formField.getAttribute('render');
        if (!renderAttr || renderAttr.getKind() !== SyntaxKind.JsxAttribute) {
            addTodoComment(formField, 'missing render prop');
            changeCount++;
            continue;
        }

        // Navigate into the render callback to find the JSX body
        const renderInitializer = renderAttr.asKindOrThrow(SyntaxKind.JsxAttribute).getInitializer();
        if (!renderInitializer) {
            addTodoComment(formField, 'empty render prop');
            changeCount++;
            continue;
        }

        // The render body should contain a FormItem with FormLabel, FormControl, etc.
        const renderText = renderInitializer.getText();

        // Extract label from <FormLabel>plainText</FormLabel>
        // Uses [^<]* which cannot backtrack (no ambiguous quantifiers)
        const labelMatch = /<FormLabel>([^<]*)<\/FormLabel>/.exec(renderText);
        const label = labelMatch ? labelMatch[1].trim() : undefined;

        // If <FormLabel> exists but didn't match plain text, it contains JSX — bail out
        if (!labelMatch && renderText.includes('<FormLabel>')) {
            addTodoComment(formField, 'complex JSX label');
            changeCount++;
            continue;
        }

        // Extract description from <FormDescription>plainText</FormDescription>
        const descMatch = /<FormDescription>([^<]*)<\/FormDescription>/.exec(renderText);
        const description = descMatch ? descMatch[1].trim() : undefined;

        // Extract the content inside <FormControl>...</FormControl>
        // Use indexOf-based extraction instead of regex to avoid backtracking
        const fcOpenTag = '<FormControl>';
        const fcCloseTag = '</FormControl>';
        const fcStart = renderText.indexOf(fcOpenTag);
        const fcEnd = renderText.indexOf(fcCloseTag);
        if (fcStart === -1 || fcEnd === -1 || fcEnd <= fcStart) {
            addTodoComment(formField, 'no FormControl found');
            changeCount++;
            continue;
        }

        const innerContent = renderText.slice(fcStart + fcOpenTag.length, fcEnd).trim();

        // Build the replacement FormFieldWrapper
        let props = '';
        if (controlAttr) {
            props += `\n    control={${controlAttr}}`;
        }
        if (nameAttr) {
            props += `\n    name=${nameAttr}`;
        }
        if (label) {
            props += `\n    label="${label}"`;
        }
        if (description) {
            props += `\n    description="${description}"`;
        }
        props += `\n    render={({ field }) => (\n        ${innerContent}\n    )}`;

        const replacement = `<FormFieldWrapper${props}\n/>`;

        formField.replaceWithText(replacement);
        changeCount++;
    }

    if (changeCount > 0) {
        removeUnusedFormImports(sourceFile);
    }

    return changeCount;
}

/**
 * Gets the raw value text of a JSX attribute (without quotes for string literals,
 * without braces for expressions).
 */
function getJsxAttributeValue(element: JsxSelfClosingElement, attrName: string): string | undefined {
    const attr = element.getAttribute(attrName);
    if (!attr || attr.getKind() !== SyntaxKind.JsxAttribute) {
        return undefined;
    }
    const initializer = attr.asKindOrThrow(SyntaxKind.JsxAttribute).getInitializer();
    if (!initializer) {
        return undefined;
    }
    const text = initializer.getText();
    // Strip surrounding braces from {expression}
    if (text.startsWith('{') && text.endsWith('}')) {
        return text.slice(1, -1);
    }
    return text;
}

/**
 * Replaces a FormField that can't be auto-converted with a wrapped version
 * that includes a TODO comment. The tag is renamed to FormFieldWrapper so
 * it won't be re-matched on the next iteration.
 */
function addTodoComment(formField: JsxSelfClosingElement, reason: string) {
    const filePath = formField.getSourceFile().getFilePath();
    const line = formField.getStartLineNumber();
    log.warn(`${filePath}:${line} — Cannot auto-convert FormField (${reason}). Added TODO comment.`);

    const original = formField.getText();
    // Rename the tag so it won't match on re-query, and wrap in a TODO comment
    const renamed = original.replace(/^<FormField/, '<FormFieldWrapper /* TODO: migrate manually */');
    formField.replaceWithText(renamed);
}

/**
 * Removes old form-specific imports (FormField, FormItem, FormControl, etc.)
 * and adds FormFieldWrapper. Import consolidation runs after this transform,
 * so we only handle the form-specific cleanup here.
 */
function removeUnusedFormImports(sourceFile: SourceFile) {
    const formImportNames = [
        'FormField',
        'FormItem',
        'FormLabel',
        'FormControl',
        'FormDescription',
        'FormMessage',
    ];

    for (const importDecl of [...sourceFile.getImportDeclarations()]) {
        const namedImports = importDecl.getNamedImports();
        for (const namedImport of [...namedImports]) {
            const name = namedImport.getName();
            if (!formImportNames.includes(name)) {
                continue;
            }
            // Re-read full text each iteration so we're checking against current state,
            // not a stale snapshot from before earlier removals.
            const currentText = sourceFile.getFullText();
            const regex = new RegExp(`\\b${name}\\b`, 'g');
            const matches = currentText.match(regex);
            // 1 match = just the import itself, safe to remove
            if (matches && matches.length <= 1) {
                namedImport.remove();
            }
        }

        // Clean up empty import declarations
        if (
            importDecl.getNamedImports().length === 0 &&
            !importDecl.getDefaultImport() &&
            !importDecl.getNamespaceImport()
        ) {
            importDecl.remove();
        }
    }

    // Add FormFieldWrapper import if not already present
    const existingDashboardImport = sourceFile.getImportDeclaration(
        decl => decl.getModuleSpecifier().getLiteralValue() === '@vendure/dashboard',
    );
    if (existingDashboardImport) {
        const existing = existingDashboardImport.getNamedImports().map(ni => ni.getName());
        if (!existing.includes('FormFieldWrapper')) {
            existingDashboardImport.addNamedImport('FormFieldWrapper');
        }
    } else {
        sourceFile.addImportDeclaration({
            moduleSpecifier: '@vendure/dashboard',
            namedImports: ['FormFieldWrapper'],
        });
    }
}
