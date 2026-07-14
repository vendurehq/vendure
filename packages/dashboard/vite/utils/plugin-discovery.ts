import { parse } from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import glob from 'fast-glob';
import fs from 'fs-extra';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

import { Logger, PluginInfo, TransformTsConfigPathMappingsFn } from '../types.js';

import { PackageScannerConfig } from './compiler.js';
import { resolvePathAliasImports, resolveSourceFile } from './import-resolution.js';
import { findTsConfigPaths } from './tsconfig-utils.js';

export async function discoverPlugins({
    vendureConfigPath,
    transformTsConfigPathMappings,
    logger,
    outputPath,
    pluginPackageScanner,
}: {
    vendureConfigPath: string;
    transformTsConfigPathMappings: TransformTsConfigPathMappingsFn;
    logger: Logger;
    outputPath: string;
    pluginPackageScanner?: PackageScannerConfig;
}): Promise<PluginInfo[]> {
    const plugins: PluginInfo[] = [];
    const nodeModulesRoot =
        pluginPackageScanner?.nodeModulesRoot ?? guessNodeModulesRoot(vendureConfigPath, logger);

    // Analyze source files to find local plugins and package imports
    const { localPluginLocations, packageImports } = await analyzeSourceFiles(
        vendureConfigPath,
        nodeModulesRoot,
        logger,
        transformTsConfigPathMappings,
    );
    logger.debug(
        `[discoverPlugins] Found ${localPluginLocations.size} local plugins: ${JSON.stringify([...localPluginLocations.entries()], null, 2)}`,
    );
    logger.debug(
        `[discoverPlugins] Found ${packageImports.length} package imports: ${JSON.stringify(packageImports, null, 2)}`,
    );
    const expandedImports = await expandPackageImports(packageImports, nodeModulesRoot, logger);
    logger.debug(
        `[discoverPlugins] Expanded to ${expandedImports.length} packages: ${JSON.stringify(expandedImports, null, 2)}`,
    );

    const filePaths = await findVendurePluginFiles({
        logger,
        nodeModulesRoot,
        packageGlobs: expandedImports.map(pkg => pkg + '/**/*.js'),
        outputPath,
        vendureConfigPath,
    });

    for (const filePath of filePaths) {
        const content = await fs.readFile(filePath, 'utf-8');
        logger.debug(`[discoverPlugins] Checking file ${filePath}`);

        // First check if this file imports from @vendure/core
        if (!content.includes('@vendure/core')) {
            continue;
        }

        try {
            const ast = parse(content, {
                ecmaVersion: 'latest',
                sourceType: 'module',
            });

            let hasVendurePlugin = false;
            let pluginName: string | undefined;
            let dashboardPath: string | undefined;

            // Walk the AST to find the plugin class and its decorator
            walkSimple(ast, {
                CallExpression(node: any) {
                    // Look for __decorate calls — handles both direct calls (__decorate(...))
                    // and tslib member expressions (tslib_1.__decorate(...)) which occur
                    // when packages are compiled with TypeScript's importHelpers: true
                    const callee = node.callee;
                    const calleeName =
                        callee.name ??
                        (callee.type === 'MemberExpression' && callee.property?.name === '__decorate'
                            ? '__decorate'
                            : undefined);
                    const nodeArgs = node.arguments;
                    const isDecoratorWithArgs = calleeName === '__decorate' && nodeArgs.length >= 2;

                    if (isDecoratorWithArgs) {
                        // Check the decorators array (first argument)
                        const decorators = nodeArgs[0];
                        if (decorators.type === 'ArrayExpression') {
                            for (const decorator of decorators.elements) {
                                const props = getDecoratorObjectProps(decorator);
                                for (const prop of props) {
                                    if (prop.key.name === 'dashboard') {
                                        if (prop.value.type === 'Literal') {
                                            // Handle string format: dashboard: './path/to/dashboard'
                                            dashboardPath = prop.value.value;
                                            hasVendurePlugin = true;
                                        } else if (prop.value.type === 'ObjectExpression') {
                                            // Handle object format: dashboard: { location: './path/to/dashboard' }
                                            const locationProp = prop.value.properties?.find(
                                                (p: any) => p.key?.name === 'location',
                                            );
                                            if (locationProp?.value.type === 'Literal') {
                                                dashboardPath = locationProp.value.value;
                                                hasVendurePlugin = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        // Get the plugin class name (second argument)
                        const targetClass = nodeArgs[1];
                        if (targetClass.type === 'Identifier') {
                            pluginName = targetClass.name;
                        }
                    }
                },
            });

            if (hasVendurePlugin && pluginName && dashboardPath) {
                logger.debug(`[discoverPlugins] Found plugin "${pluginName}" in file: ${filePath}`);
                // Keep the dashboard path relative to the plugin file
                const resolvedDashboardPath = dashboardPath.startsWith('.')
                    ? dashboardPath // Keep the relative path as-is
                    : './' + path.relative(path.dirname(filePath), dashboardPath); // Make absolute path relative

                // Check if this is a local plugin we found earlier
                const sourcePluginPath = localPluginLocations.get(pluginName);

                plugins.push({
                    name: pluginName,
                    pluginPath: filePath,
                    dashboardEntryPath: resolvedDashboardPath,
                    ...(sourcePluginPath && { sourcePluginPath }),
                });
            }
        } catch (e) {
            logger.error(`Failed to parse ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    return plugins;
}

function getDecoratorObjectProps(decorator: any): any[] {
    if (
        decorator.type === 'CallExpression' &&
        decorator.arguments.length === 1 &&
        decorator.arguments[0].type === 'ObjectExpression'
    ) {
        // Look for the dashboard property in the decorator config
        return decorator.arguments[0].properties ?? [];
    }
    return [];
}

/**
 * Expands the list of package imports by checking each package's `dependencies`
 * for additional Vendure plugin packages. This handles the "meta-package" pattern
 * where a single package re-exports/configures multiple plugins internally.
 *
 * Only goes one level deep (not recursive) to keep the cost predictable — the
 * typical meta-package directly lists its plugin sub-packages as dependencies.
 * A transitive dep is included only if it depends on `@vendure/core` (in its
 * own dependencies or peerDependencies), which is a strong signal for a Vendure plugin.
 *
 * Note: This resolves packages via filesystem paths under `nodeModulesRoot`.
 * Under Yarn PnP or pnpm strict isolation, transitive deps may not be resolvable
 * at the expected paths. In those cases, the expansion gracefully finds nothing.
 */
async function expandPackageImports(
    packageImports: string[],
    nodeModulesRoot: string,
    logger: Logger,
): Promise<string[]> {
    const expanded = new Set(packageImports);

    for (const pkg of packageImports) {
        let pkgJson: any;
        try {
            pkgJson = await fs.readJson(path.join(nodeModulesRoot, pkg, 'package.json'));
        } catch (e) {
            logger.debug(
                `[expandPackageImports] Could not read package.json for ${pkg}: ${e instanceof Error ? e.message : String(e)}`,
            );
            continue;
        }
        const deps = Object.keys(pkgJson.dependencies ?? {});

        await Promise.all(
            deps.map(async dep => {
                if (expanded.has(dep) || dep.startsWith('@vendure/')) return;

                let depPkgJson: any;
                try {
                    depPkgJson = await fs.readJson(path.join(nodeModulesRoot, dep, 'package.json'));
                } catch {
                    logger.debug(
                        `[expandPackageImports] Could not read package.json for transitive dep ${dep} (via ${pkg})`,
                    );
                    return;
                }
                const allDeps = {
                    ...depPkgJson.dependencies,
                    ...depPkgJson.peerDependencies,
                };

                if ('@vendure/core' in allDeps) {
                    logger.debug(
                        `[expandPackageImports] Found transitive Vendure package: ${dep} (via ${pkg})`,
                    );
                    expanded.add(dep);
                }
            }),
        );
    }

    return Array.from(expanded);
}

async function isSymlinkedLocalPackage(
    packageName: string,
    nodeModulesRoot: string,
): Promise<string | undefined> {
    try {
        const packagePath = path.join(nodeModulesRoot, packageName);
        const stats = await fs.lstat(packagePath);
        if (stats.isSymbolicLink()) {
            // Get the real path that the symlink points to
            const realPath = await fs.realpath(packagePath);
            // If the real path is within the project directory (i.e. not in some other node_modules),
            // then it's a local package
            if (!realPath.includes('node_modules')) {
                return realPath;
            }
        }
    } catch (e) {
        // Package doesn't exist or other error - not a local package
        return undefined;
    }
    return undefined;
}

/**
 * Analyzes TypeScript source files starting from the config file to discover:
 * 1. Local Vendure plugins
 * 2. All non-local package imports that could contain plugins
 */
export async function analyzeSourceFiles(
    vendureConfigPath: string,
    nodeModulesRoot: string,
    logger: Logger,
    transformTsConfigPathMappings: TransformTsConfigPathMappingsFn,
): Promise<{
    localPluginLocations: Map<string, string>;
    packageImports: string[];
}> {
    const localPluginLocations = new Map<string, string>();
    const visitedFiles = new Set<string>();
    const packageImportsSet = new Set<string>();

    // Get tsconfig paths for resolving aliases
    const tsConfigInfo = await findTsConfigPaths(
        vendureConfigPath,
        logger,
        'compiling',
        transformTsConfigPathMappings,
    );

    async function processFile(filePath: string) {
        if (visitedFiles.has(filePath)) {
            return;
        }
        visitedFiles.add(filePath);

        try {
            // First check if this is a directory
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                // If it's a directory, try to find the plugin file
                const indexFilePath = path.join(filePath, 'index.ts');
                if (await fs.pathExists(indexFilePath)) {
                    await processFile(indexFilePath);
                }
                return;
            }

            const content = await fs.readFile(filePath, 'utf-8');
            const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

            // Track imports to follow
            const importsToFollow: string[] = [];

            async function visit(node: ts.Node) {
                // Look for VendurePlugin decorator
                const vendurePluginClassName = getVendurePluginClassName(node);
                if (vendurePluginClassName) {
                    localPluginLocations.set(vendurePluginClassName, filePath);
                    logger.debug(`Found plugin "${vendurePluginClassName}" at ${filePath}`);
                }

                // Handle both imports and exports
                const isImportOrExport = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
                if (isImportOrExport) {
                    const moduleSpecifier = node.moduleSpecifier;
                    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
                        const importPath = moduleSpecifier.text;

                        // Track non-local imports (packages)
                        const npmPackageName = getNpmPackageNameFromImport(importPath);
                        if (npmPackageName) {
                            // Check if this is actually a symlinked local package
                            const localPackagePath = await isSymlinkedLocalPackage(
                                npmPackageName,
                                nodeModulesRoot,
                            );
                            if (localPackagePath) {
                                // If it is local, follow it like a local import
                                importsToFollow.push(localPackagePath);
                                logger.debug(
                                    `Found symlinked local package "${npmPackageName}" at ${localPackagePath}`,
                                );
                            } else {
                                packageImportsSet.add(npmPackageName);
                            }
                        }
                        // Handle path aliases and local imports
                        const pathAliasImports = resolvePathAliasImports(importPath, tsConfigInfo);
                        if (pathAliasImports.length) {
                            importsToFollow.push(...pathAliasImports);
                        }
                        // Also handle local imports
                        if (importPath.startsWith('.')) {
                            const resolvedPath = path.resolve(path.dirname(filePath), importPath);
                            importsToFollow.push(resolvedPath);
                        }
                    }
                }

                // Visit children
                const promises: Array<Promise<void>> = [];
                ts.forEachChild(node, child => {
                    promises.push(visit(child));
                });
                await Promise.all(promises);
            }

            await visit(sourceFile);

            // Follow imports using shared resolution logic
            for (const importPath of importsToFollow) {
                const resolved = await resolveSourceFile(importPath);
                if (resolved) {
                    await processFile(resolved);
                }
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            logger.error(`Failed to process ${filePath}: ${message}`);
        }
    }

    await processFile(vendureConfigPath);
    return {
        localPluginLocations,
        packageImports: Array.from(packageImportsSet),
    };
}

/**
 * If this is a class declaration that is decorated with the `VendurePlugin` decorator,
 * we want to return that class name, as we have found a local Vendure plugin.
 */
function getVendurePluginClassName(node: ts.Node): string | undefined {
    if (ts.isClassDeclaration(node)) {
        const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
        if (decorators?.length) {
            for (const decorator of decorators) {
                const decoratorName = getDecoratorName(decorator);
                if (decoratorName === 'VendurePlugin') {
                    const className = node.name?.text;
                    if (className) {
                        return className;
                    }
                }
            }
        }
    }
}

function getNpmPackageNameFromImport(importPath: string): string | undefined {
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        // Get the root package name (e.g. '@scope/package/subpath' -> '@scope/package')
        const packageName = importPath.startsWith('@')
            ? importPath.split('/').slice(0, 2).join('/')
            : importPath.split('/')[0];
        return packageName;
    }
}

function getDecoratorName(decorator: ts.Decorator): string | undefined {
    if (ts.isCallExpression(decorator.expression)) {
        const expression = decorator.expression.expression;
        // Handle both direct usage and imported usage
        if (ts.isIdentifier(expression)) {
            return expression.text;
        }
        // Handle property access like `Decorators.VendurePlugin`
        if (ts.isPropertyAccessExpression(expression)) {
            return expression.name.text;
        }
    }
    return undefined;
}

interface FindPluginFilesOptions {
    outputPath: string;
    vendureConfigPath: string;
    logger: Logger;
    packageGlobs: string[];
    nodeModulesRoot?: string;
}

export async function findVendurePluginFiles({
    outputPath,
    vendureConfigPath,
    logger,
    nodeModulesRoot: providedNodeModulesRoot,
    packageGlobs,
}: FindPluginFilesOptions): Promise<string[]> {
    let nodeModulesRoot = providedNodeModulesRoot;
    const readStart = Date.now();
    if (!nodeModulesRoot) {
        nodeModulesRoot = guessNodeModulesRoot(vendureConfigPath, logger);
    }

    const patterns = [
        // Local compiled plugins in temp dir
        path.join(outputPath, '**/*.js'),
        // Node modules patterns
        ...packageGlobs.map(pattern => path.join(nodeModulesRoot, pattern)),
    ].map(p => p.replace(/\\/g, '/'));

    logger.debug(`Finding Vendure plugins using patterns: ${patterns.join('\n')}`);

    const globStart = Date.now();
    const files = await glob(patterns, {
        ignore: [
            // Skip nested node_modules (transitive deps) but not .pnpm or .bun directories.
            // [!.] excludes paths starting with . since pnpm and bun store packages there.
            '**/node_modules/[!.]*/**/node_modules/**',
            '**/*.spec.js',
            '**/*.test.js',
        ],
        onlyFiles: true,
        absolute: true,
        followSymbolicLinks: false,
        stats: false,
    });
    logger.debug(`Glob found ${files.length} files in ${Date.now() - globStart}ms`);

    // Read files in larger parallel batches
    const batchSize = 100; // Increased batch size
    const potentialPluginFiles: string[] = [];

    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map(async file => {
                try {
                    const fileHandle = await open(file, 'r');
                    try {
                        const buffer = Buffer.alloc(5000);
                        const { bytesRead } = await fileHandle.read(buffer, 0, 5000, 0);
                        const content = buffer.toString('utf8', 0, bytesRead);
                        if (content.includes('@vendure/core')) {
                            return file;
                        }
                    } finally {
                        await fileHandle.close();
                    }
                } catch (e: any) {
                    logger.warn(`Failed to read file ${file}: ${e instanceof Error ? e.message : String(e)}`);
                }
                return null;
            }),
        );

        const validResults = results.filter((f): f is string => f !== null);
        potentialPluginFiles.push(...validResults);
    }

    logger.info(
        `Found ${potentialPluginFiles.length} potential plugin files in ${Date.now() - readStart}ms ` +
            `(scanned ${files.length} files)`,
    );

    return potentialPluginFiles;
}

function guessNodeModulesRoot(vendureConfigPath: string, logger: Logger): string {
    let nodeModulesRoot: string;
    // If the node_modules root path has not been explicitly
    // specified, we will try to guess it by resolving the
    // `@vendure/core` package.
    try {
        const coreUrl = import.meta.resolve('@vendure/core');
        logger.debug(`Found core URL: ${coreUrl}`);
        const corePath = fileURLToPath(coreUrl);
        logger.debug(`Found core path: ${corePath}`);
        nodeModulesRoot = path.join(path.dirname(corePath), '..', '..', '..');
    } catch (e) {
        logger.warn(`Failed to resolve @vendure/core: ${e instanceof Error ? e.message : String(e)}`);
        nodeModulesRoot = path.dirname(vendureConfigPath);
    }
    return nodeModulesRoot;
}
