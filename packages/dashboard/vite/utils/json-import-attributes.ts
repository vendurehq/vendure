import type { ImportAttributes, Node, StringLiteral } from 'typescript/ast';
import { isExportDeclaration, isImportDeclaration, isStringLiteral } from 'typescript/ast/is';

import { withSourceFileSync } from './typescript-api.js';

const TYPE_JSON = "type: 'json'";

/**
 * Adds `type: 'json'` to the import attributes of import and export declarations
 * of `.json` specifiers that do not already carry a `type` attribute. Any other
 * attributes, including an empty `with {}`, are kept and the entry is appended.
 *
 * Matching on the `.json` suffix is a superset of the rule `collectLocalSourceFiles`
 * uses to copy a JSON file. Bare specifiers such as `some-pkg/data.json` are never
 * copied, but still get the attribute, because Node requires it for them too.
 *
 * The TypeScript 7 `transpileModule()` API does not support custom transformers, so
 * like the path transformer (`path-transformer.ts`) this edits the *emitted* JavaScript: it parses the
 * output, locates the declarations, and splices in the attribute. Everything else in
 * the output is left byte-for-byte unchanged.
 *
 * @param outputText - the JavaScript emitted for a source file
 * @param sourceFilePath - the path of the original `.ts` source file
 */
export function addJsonImportAttributes(outputText: string, sourceFilePath: string): string {
    // Cheap pre-check: skip parsing if no JSON specifier can occur in the output
    if (!outputText.includes('.json')) {
        return outputText;
    }
    const jsFileName = sourceFilePath.replace(/\.[cm]?tsx?$/, '.js');
    const edits: Array<{ position: number; text: string }> = [];

    withSourceFileSync(jsFileName, outputText, sourceFile => {
        // Import and export declarations can only appear at the top level of a module
        sourceFile.forEachChild((node: Node) => {
            if (!isImportDeclaration(node) && !isExportDeclaration(node)) {
                return;
            }
            const moduleSpecifier = node.moduleSpecifier;
            if (
                !moduleSpecifier ||
                !isStringLiteral(moduleSpecifier) ||
                !moduleSpecifier.text.endsWith('.json')
            ) {
                return;
            }
            const edit = getAttributeEdit(outputText, moduleSpecifier, node.attributes);
            if (edit) {
                edits.push(edit);
            }
        });
    });

    // Apply edits from the end of the file so earlier offsets stay valid
    let result = outputText;
    for (const edit of edits.sort((a, b) => b.position - a.position)) {
        result = result.slice(0, edit.position) + edit.text + result.slice(edit.position);
    }
    return result;
}

function getAttributeEdit(
    outputText: string,
    moduleSpecifier: StringLiteral,
    attributes: ImportAttributes | undefined,
): { position: number; text: string } | undefined {
    if (!attributes) {
        // import data from './data.json' -> import data from './data.json' with { type: 'json' }
        return { position: moduleSpecifier.end, text: ` with { ${TYPE_JSON} }` };
    }
    if (attributes.attributes.some(attribute => attribute.name.text === 'type')) {
        return undefined;
    }
    const lastElement = attributes.attributes[attributes.attributes.length - 1];
    if (lastElement) {
        // with { foo: 'bar' } -> with { foo: 'bar', type: 'json' }
        return { position: lastElement.end, text: `, ${TYPE_JSON}` };
    }
    // with {} -> with { type: 'json' }
    const closingBrace = outputText.lastIndexOf('}', attributes.end - 1);
    return { position: closingBrace, text: ` ${TYPE_JSON} ` };
}
