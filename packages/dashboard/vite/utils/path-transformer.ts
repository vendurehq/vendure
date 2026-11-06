import * as path from 'node:path';
import type { Node, StringLiteral } from 'typescript/ast';
import { SyntaxKind } from 'typescript/ast';
import {
    isCallExpression,
    isExportDeclaration,
    isImportDeclaration,
    isStringLiteral,
} from 'typescript/ast/is';

import { withSourceFileSync } from './typescript-api.js';

export interface PathTransformerOptions {
    baseUrl: string;
    paths: Record<string, string[]>;
}

interface PathMatcher {
    pattern: string;
    regex: RegExp;
    targets: string[];
    hasWildcard: boolean;
}

/**
 * Rewrites the module specifiers of compiled JavaScript output.
 *
 * @param outputText - the JavaScript emitted for a source file
 * @param sourceFilePath - the path of the original `.ts` source file, used to compute
 *   relative paths
 */
export type PathTransformer = (outputText: string, sourceFilePath: string) => string;

/**
 * Creates a function that rewrites import/export paths in emitted JavaScript from
 * tsconfig path aliases to their resolved relative paths.
 *
 * This is necessary for ESM mode where tsconfig-paths.register() doesn't work
 * because it only hooks into CommonJS require(), not ESM import().
 *
 * The TypeScript 7 `transpileModule()` API does not support custom transformers, so
 * instead of transforming the TypeScript AST, this parses the *emitted* JavaScript,
 * locates the module specifier string literals of import/export declarations and
 * dynamic `import()` calls, and splices in the rewritten specifiers. Everything else
 * in the output is left byte-for-byte unchanged, and since this runs after
 * TypeScript has elided type-only imports, only runtime imports are touched.
 *
 * The transformer uses the source file's location and the tsconfig baseUrl to
 * compute correct relative paths, even for files in nested directories.
 *
 * Known limitations:
 * - Only the first path target is used when multiple fallbacks are configured
 * - `require()` calls via `createRequire` are not transformed
 */
export function createPathTransformer(options: PathTransformerOptions): PathTransformer {
    const { baseUrl, paths } = options;

    // Compile the path patterns into matchers
    const pathMatchers = Object.entries(paths).map(([pattern, targets]) => {
        const hasWildcard = pattern.includes('*');

        // Escape special regex chars, then replace * with capture group
        const regexStr: string = pattern
            .replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
            .split('*')
            .join('(.*)');

        const regex = new RegExp('^' + regexStr + '$');

        return { pattern, regex, targets, hasWildcard };
    });

    return (outputText, sourceFilePath) => {
        // Cheap pre-check: skip parsing if no alias prefix occurs in the output at all
        const aliasPrefixes = Object.keys(paths).map(pattern => pattern.split('*')[0]);
        if (!aliasPrefixes.some(prefix => outputText.includes(prefix))) {
            return outputText;
        }

        const sourceDir = path.dirname(sourceFilePath);
        const jsFileName = sourceFilePath.replace(/\.[cm]?tsx?$/, '.js');
        const edits: Array<{ start: number; end: number; text: string }> = [];

        withSourceFileSync(jsFileName, outputText, sourceFile => {
            const addEdit = (literal: StringLiteral) => {
                const resolvedPath = resolvePathAlias(literal.text, pathMatchers, baseUrl, sourceDir);
                if (resolvedPath) {
                    const start = literal.getStart(sourceFile);
                    // Preserve the original quote style
                    const quote = outputText[start];
                    edits.push({ start, end: literal.end, text: quote + resolvedPath + quote });
                }
            };

            const visit = (node: Node) => {
                // import { X } from 'module'; export { X } from 'module';
                if (
                    (isImportDeclaration(node) || isExportDeclaration(node)) &&
                    node.moduleSpecifier &&
                    isStringLiteral(node.moduleSpecifier)
                ) {
                    addEdit(node.moduleSpecifier);
                }
                // import('module')
                if (
                    isCallExpression(node) &&
                    node.expression.kind === SyntaxKind.ImportKeyword &&
                    node.arguments.length > 0 &&
                    isStringLiteral(node.arguments[0])
                ) {
                    addEdit(node.arguments[0]);
                }
                node.forEachChild(visit);
            };
            visit(sourceFile);
        });

        // Apply edits from the end of the file so earlier offsets stay valid
        let result = outputText;
        for (const edit of edits.sort((a, b) => b.start - a.start)) {
            result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
        }
        return result;
    };
}

/**
 * Resolves a path alias to its actual path, computed relative to the source file's directory.
 * Returns undefined if the module specifier doesn't match any path alias.
 */
function resolvePathAlias(
    moduleSpecifier: string,
    pathMatchers: PathMatcher[],
    baseUrl: string,
    sourceDir: string,
): string | undefined {
    if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
        return undefined;
    }

    for (const { regex, targets, hasWildcard } of pathMatchers) {
        const match = regex.exec(moduleSpecifier);
        if (match) {
            const target = targets[0];
            const resolved = hasWildcard && match[1] ? target.split('*').join(match[1]) : target;

            // Compute absolute target path from baseUrl, then get relative path from source dir
            const absoluteTarget = path.resolve(baseUrl, resolved);
            let relativePath = path.relative(sourceDir, absoluteTarget);

            // Normalize path separators to forward slashes
            relativePath = relativePath.split('\\').join('/');

            // Ensure relative path has ./ or ../ prefix
            if (!relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
            }

            // Convert TypeScript extensions to JavaScript equivalents for ESM
            return convertExtension(relativePath);
        }
    }

    return undefined;
}

/**
 * Converts TypeScript extensions to JavaScript equivalents for ESM.
 * .ts -> .js, .tsx -> .js, .mts -> .mjs, .cts -> .cjs
 */
function convertExtension(filePath: string): string {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        return filePath.replace(/\.tsx?$/, '.js');
    }
    if (filePath.endsWith('.mts')) {
        return filePath.replace(/\.mts$/, '.mjs');
    }
    if (filePath.endsWith('.cts')) {
        return filePath.replace(/\.cts$/, '.cjs');
    }
    // No extension - assume directory import, add /index.js
    if (!/\.\w+$/.test(filePath)) {
        return `${filePath}/index.js`;
    }
    // Files with other extensions (.json, .js, etc.) are left as-is
    return filePath;
}
