import type { VendureConfig } from '@vendure/core';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import tsConfigPaths from 'tsconfig-paths';
import { RegisterParams } from 'tsconfig-paths/lib/register.js';
import * as ts from 'typescript';

import { Logger, PathAdapter, PluginInfo } from '../types.js';

import { findConfigExport } from './ast-utils.js';
import { resolvePathAliasImports, resolveSourceFile } from './import-resolution.js';
import { noopLogger } from './logger.js';
import { createPathTransformer } from './path-transformer.js';
import { discoverPlugins } from './plugin-discovery.js';
import { findTsConfigPaths } from './tsconfig-utils.js';

const defaultPathAdapter: Required<
    Pick<PathAdapter, 'getCompiledConfigPath' | 'transformTsConfigPathMappings'>
> = {
    getCompiledConfigPath: ({ outputPath, configFileName }) => path.join(outputPath, configFileName),
    transformTsConfigPathMappings: ({ patterns }) => patterns,
};

export interface PackageScannerConfig {
    nodeModulesRoot?: string;
}

export interface CompilerOptions {
    vendureConfigPath: string;
    outputPath: string;
    pathAdapter?: PathAdapter;
    logger?: Logger;
    pluginPackageScanner?: PackageScannerConfig;
    module?: 'commonjs' | 'esm';
}

export interface CompileResult {
    vendureConfig: VendureConfig;
    exportedSymbolName: string;
    pluginInfo: PluginInfo[];
}

/**
 * Compiles TypeScript files and discovers Vendure plugins in both the compiled output
 * and in node_modules.
 */
export async function compile(options: CompilerOptions): Promise<CompileResult> {
    const { vendureConfigPath, outputPath, pathAdapter, logger = noopLogger, pluginPackageScanner } = options;
    const getCompiledConfigPath =
        pathAdapter?.getCompiledConfigPath ?? defaultPathAdapter.getCompiledConfigPath;
    const transformTsConfigPathMappings =
        pathAdapter?.transformTsConfigPathMappings ?? defaultPathAdapter.transformTsConfigPathMappings;

    // 0. Clear the outputPath
    fs.removeSync(outputPath);

    // 1. Compile TypeScript files
    const compileStart = Date.now();
    await compileTypeScript({
        inputPath: vendureConfigPath,
        outputPath,
        logger,
        module: options.module ?? 'commonjs',
        sourceRoot: pathAdapter?.sourceRoot,
    });
    logger.info(`TypeScript compilation completed in ${Date.now() - compileStart}ms`);

    // 2. Discover plugins
    const analyzePluginsStart = Date.now();
    const plugins = await discoverPlugins({
        vendureConfigPath,
        transformTsConfigPathMappings,
        logger,
        outputPath,
        pluginPackageScanner,
    });
    logger.info(
        `Analyzed plugins and found ${plugins.length} dashboard extensions in ${Date.now() - analyzePluginsStart}ms`,
    );

    // 3. Load the compiled config
    // Note: configFileName is kept as the basename to preserve the public API contract.
    // Custom pathAdapter implementations (e.g. in monorepos) rely on this being just
    // the filename, not a relative path — they hardcode the directory structure themselves.
    const configFileName = path.basename(vendureConfigPath);
    const compiledConfigFilePath = pathToFileURL(
        getCompiledConfigPath({
            inputRootDir: path.dirname(vendureConfigPath),
            outputPath,
            configFileName,
        }),
    ).href.replace(/\.ts$/, '.js');

    // Create package.json with type commonjs
    await fs.writeFile(
        path.join(outputPath, 'package.json'),
        JSON.stringify({ type: options.module === 'esm' ? 'module' : 'commonjs', private: true }, null, 2),
    );

    // Find the exported config symbol
    const sourceFile = ts.createSourceFile(
        vendureConfigPath,
        await fs.readFile(vendureConfigPath, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const exportedSymbolName = findConfigExport(sourceFile);
    if (!exportedSymbolName) {
        throw new Error(
            `Could not find a variable exported as VendureConfig. Please specify the name of the exported variable.`,
        );
    }

    const loadConfigStart = Date.now();

    await registerTsConfigPaths({
        outputPath,
        configPath: vendureConfigPath,
        logger,
        phase: 'loading',
        transformTsConfigPathMappings,
    });

    let config: any;
    try {
        config = await import(compiledConfigFilePath).then(m => m[exportedSymbolName]);
    } catch (e: any) {
        const errorMessage =
            e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : JSON.stringify(e, null, 2);
        logger.error(`Error loading config: ${errorMessage}`);
    }
    if (!config) {
        throw new Error(
            `Could not find a variable exported as VendureConfig with the name "${exportedSymbolName}".`,
        );
    }
    logger.debug(`Loaded config in ${Date.now() - loadConfigStart}ms`);

    return { vendureConfig: config, exportedSymbolName, pluginInfo: plugins };
}

/**
 * Compiles TypeScript files to JavaScript using per-file transpilation.
 *
 * Instead of using `ts.createProgram()` (which resolves all imports including
 * node_modules type definitions and can OOM on projects with heavy dependencies),
 * this function:
 * 1. Walks the import tree via lightweight AST parsing to find all local source files
 * 2. Transpiles each file individually with `ts.transpileModule()` (no type resolution)
 *
 * This avoids loading massive `.d.ts` files from packages like `openai`, `ai`, etc.
 * See: https://github.com/vendurehq/vendure/issues/4559
 */
async function compileTypeScript({
    inputPath,
    outputPath,
    logger,
    module,
    sourceRoot: customSourceRoot,
}: {
    inputPath: string;
    outputPath: string;
    logger: Logger;
    module: 'commonjs' | 'esm';
    sourceRoot?: string;
}): Promise<void> {
    await fs.ensureDir(outputPath);

    // Find tsconfig paths for resolving path aliases in the import tree
    const originalTsConfigInfo = await findTsConfigPaths(
        inputPath,
        logger,
        'compiling',
        ({ patterns }) => patterns, // No transformation - use original paths
    );

    logger.debug(`tsConfig paths: ${JSON.stringify(originalTsConfigInfo?.paths, null, 2)}`);
    logger.debug(`tsConfig baseUrl: ${originalTsConfigInfo?.baseUrl ?? 'UNKNOWN'}`);

    // 1. Collect all local source files by walking the import tree
    const collectStart = Date.now();
    const sourceFiles = await collectLocalSourceFiles(inputPath, originalTsConfigInfo);
    logger.debug(`Collected ${sourceFiles.length} source files in ${Date.now() - collectStart}ms`);

    // 2. Build path transformer for ESM mode
    // This is necessary because tsconfig-paths.register() only works for CommonJS require(),
    // not for ESM import(). We need to transform the import paths during transpilation.
    let pathTransformer: ts.TransformerFactory<ts.SourceFile> | undefined;
    if (module === 'esm' && originalTsConfigInfo) {
        logger.debug('Adding path transformer for ESM mode');
        pathTransformer = createPathTransformer({
            baseUrl: originalTsConfigInfo.baseUrl,
            paths: originalTsConfigInfo.paths,
        });
    }

    // 3. Determine the source root for computing output directory structure.
    // Compiled files preserve their directory structure relative to this root.
    // In monorepos, set pathAdapter.sourceRoot to the workspace root so that
    // e.g. apps/server/src/config.ts → {output}/apps/server/src/config.js.
    // Defaults to the config file's directory, placing it at the output root.
    const sourceRoot = customSourceRoot ?? path.dirname(inputPath);

    // 4. Transpile each file individually
    // Note: emitDecoratorMetadata with transpileModule emits `Object` for all
    // imported types since there is no type resolver. This is acceptable because
    // the compiled output is only used for config loading and plugin discovery,
    // not for runtime dependency injection.
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: module === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
    };
    const transformers: ts.CustomTransformers | undefined = pathTransformer
        ? { after: [pathTransformer] }
        : undefined;

    for (const filePath of sourceFiles) {
        const content = await fs.readFile(filePath, 'utf-8');
        const result = ts.transpileModule(content, {
            compilerOptions,
            fileName: filePath,
            transformers,
        });

        // Compute output path preserving directory structure relative to source root
        const relativePath = path.relative(sourceRoot, filePath);
        const outputFilePath = path.join(outputPath, relativePath).replace(/\.tsx?$/, '.js');

        await fs.ensureDir(path.dirname(outputFilePath));
        await fs.writeFile(outputFilePath, result.outputText);
    }
}

/**
 * Collects all local source files reachable from the entry point by following
 * import/export declarations. Only follows local imports (relative paths and
 * tsconfig path aliases), not npm package imports.
 *
 * This is intentionally lightweight — it uses TypeScript's AST parser only
 * for reading import statements, without any module resolution or type loading.
 */
async function collectLocalSourceFiles(
    entryFile: string,
    tsConfigInfo?: { baseUrl: string; paths: Record<string, string[]> },
): Promise<string[]> {
    const visited = new Set<string>();

    async function processFile(filePath: string) {
        const resolved = await resolveSourceFile(filePath);
        if (!resolved) return;

        // Skip declaration files and non-source files before adding to visited,
        // so they don't leak into the returned sourceFiles array.
        if (resolved.endsWith('.d.ts') || resolved.endsWith('.d.tsx')) return;
        if (!/\.(ts|tsx|js|jsx)$/.test(resolved)) return;

        if (visited.has(resolved)) return;
        visited.add(resolved);

        const content = await fs.readFile(resolved, 'utf-8');
        const sf = ts.createSourceFile(resolved, content, ts.ScriptTarget.Latest, true);
        const dir = path.dirname(resolved);
        const importsToFollow: string[] = [];

        ts.forEachChild(sf, node => {
            if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
            const moduleSpecifier = node.moduleSpecifier;
            if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) return;
            const importPath = moduleSpecifier.text;

            // Follow local relative imports
            if (importPath.startsWith('.')) {
                importsToFollow.push(path.resolve(dir, importPath));
                return;
            }

            // Follow tsconfig path aliases (uses shared resolution logic)
            importsToFollow.push(...resolvePathAliasImports(importPath, tsConfigInfo));
            // npm package imports are intentionally skipped — they are resolved
            // at runtime via require() / import(), not during transpilation.
        });

        for (const imp of importsToFollow) {
            await processFile(imp);
        }
    }

    await processFile(entryFile);
    return [...visited];
}

async function registerTsConfigPaths(options: {
    outputPath: string;
    configPath: string;
    logger: Logger;
    phase: 'compiling' | 'loading';
    transformTsConfigPathMappings: Required<PathAdapter>['transformTsConfigPathMappings'];
}) {
    const { outputPath, configPath, logger, phase, transformTsConfigPathMappings } = options;
    const tsConfigInfo = await findTsConfigPaths(configPath, logger, phase, transformTsConfigPathMappings);
    if (tsConfigInfo) {
        const params: RegisterParams = {
            baseUrl: outputPath,
            paths: tsConfigInfo.paths,
        };
        logger.debug(`Registering tsconfig paths: ${JSON.stringify(params, null, 2)}`);
        tsConfigPaths.register(params);
    }
}
