import * as path from 'node:path';
import * as ts from 'typescript';

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
 * Creates a TypeScript custom transformer that rewrites import/export paths
 * from tsconfig path aliases to their resolved relative paths.
 *
 * This is necessary for ESM mode where tsconfig-paths.register() doesn't work
 * because it only hooks into CommonJS require(), not ESM import().
 *
 * The transformer uses the source file's location and the tsconfig baseUrl to
 * compute correct relative paths, even for files in nested directories.
 *
 * Known limitations:
 * - Only the first path target is used when multiple fallbacks are configured
 * - `require()` calls via `createRequire` are not transformed
 */
export function createPathTransformer(options: PathTransformerOptions): ts.TransformerFactory<ts.SourceFile> {
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

    return context => {
        return sourceFile => {
            const sourceDir = path.dirname(sourceFile.fileName);

            const visitor: ts.Visitor = node => {
                // Handle import declarations: import { X } from 'module';
                if (
                    ts.isImportDeclaration(node) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const resolvedPath = resolvePathAlias(
                        node.moduleSpecifier.text,
                        pathMatchers,
                        baseUrl,
                        sourceDir,
                    );
                    if (resolvedPath) {
                        return context.factory.updateImportDeclaration(
                            node,
                            node.modifiers,
                            node.importClause,
                            context.factory.createStringLiteral(resolvedPath),
                            node.attributes,
                        );
                    }
                }

                // Handle export declarations: export { X } from 'module';
                if (
                    ts.isExportDeclaration(node) &&
                    node.moduleSpecifier &&
                    ts.isStringLiteral(node.moduleSpecifier)
                ) {
                    const resolvedPath = resolvePathAlias(
                        node.moduleSpecifier.text,
                        pathMatchers,
                        baseUrl,
                        sourceDir,
                    );
                    if (resolvedPath) {
                        return context.factory.updateExportDeclaration(
                            node,
                            node.modifiers,
                            node.isTypeOnly,
                            node.exportClause,
                            context.factory.createStringLiteral(resolvedPath),
                            node.attributes,
                        );
                    }
                }

                // Handle dynamic imports: import('module')
                if (
                    ts.isCallExpression(node) &&
                    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
                    node.arguments.length > 0 &&
                    ts.isStringLiteral(node.arguments[0])
                ) {
                    const resolvedPath = resolvePathAlias(
                        node.arguments[0].text,
                        pathMatchers,
                        baseUrl,
                        sourceDir,
                    );
                    if (resolvedPath) {
                        return context.factory.updateCallExpression(
                            node,
                            node.expression,
                            node.typeArguments,
                            [context.factory.createStringLiteral(resolvedPath), ...node.arguments.slice(1)],
                        );
                    }
                }

                return ts.visitEachChild(node, visitor, context);
            };

            return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
        };
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
