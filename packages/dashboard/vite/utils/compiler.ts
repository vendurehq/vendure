import { VendureConfig } from '@vendure/core';
import fs from 'fs-extra';
import path from 'path';
import tsConfigPaths from 'tsconfig-paths';
import { RegisterParams } from 'tsconfig-paths/lib/register.js';
import * as ts from 'typescript';
import { pathToFileURL } from 'url';

import { Logger, PathAdapter, PluginInfo } from '../types.js';

import { findConfigExport } from './ast-utils.js';
import { noopLogger } from './logger.js';
import { discoverPlugins } from './plugin-discovery.js';
import { findTsConfigPaths } from './tsconfig-utils.js';

const defaultPathAdapter: Required<PathAdapter> = {
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
        transformTsConfigPathMappings,
        module: options.module ?? 'commonjs',
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
    const configFileName = path.basename(vendureConfigPath);
    const compiledConfigFilePath = pathToFileURL(
        getCompiledConfigPath({
            inputRootDir: path.dirname(vendureConfigPath),
            outputPath,
            configFileName,
        }),
    ).href.replace(/.ts$/, '.js');

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
    } catch (e) {
        logger.error(`Error loading config: ${e instanceof Error ? e.message : String(e)}`);
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
 * Compiles TypeScript files to JavaScript
 */
async function compileTypeScript({
    inputPath,
    outputPath,
    logger,
    transformTsConfigPathMappings,
    module,
}: {
    inputPath: string;
    outputPath: string;
    logger: Logger;
    transformTsConfigPathMappings: Required<PathAdapter>['transformTsConfigPathMappings'];
    module: 'commonjs' | 'esm';
}): Promise<void> {
    await fs.ensureDir(outputPath);

    // Find tsconfig paths first
    const tsConfigInfo = await findTsConfigPaths(
        inputPath,
        logger,
        'compiling',
        transformTsConfigPathMappings,
    );

    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: module === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10, // More explicit CJS resolution
        jsx: ts.JsxEmit.ReactJSX, // Emit React JSX optimized for production
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: false,
        // Speed optimizations
        noEmitOnError: false, // Emit output even if there are errors
        noImplicitAny: false, // Don't require implicit any
        noUnusedLocals: false, // Don't check for unused locals
        noUnusedParameters: false, // Don't check for unused parameters
        allowJs: true,
        checkJs: false, // Don't type check JS files
        skipDefaultLibCheck: true, // Skip checking .d.ts files
        isolatedModules: false, // Need to check cross-file references to compile dependencies
        incremental: false, // Don't use incremental compilation (faster for one-off builds)
        resolveJsonModule: true,
        preserveSymlinks: false,
        outDir: outputPath,
    };

    logger.debug(`Compiling ${inputPath} to ${outputPath} using TypeScript...`);

    // Add path mappings if found
    if (tsConfigInfo) {
        // We need to set baseUrl and paths for TypeScript to resolve the imports
        compilerOptions.baseUrl = tsConfigInfo.baseUrl;
        compilerOptions.paths = tsConfigInfo.paths;
        // This is critical - it tells TypeScript to preserve the paths in the output
        // compilerOptions.rootDir = tsConfigInfo.baseUrl;
    }

    logger.debug(`tsConfig paths: ${JSON.stringify(tsConfigInfo?.paths, null, 2)}`);
    logger.debug(`tsConfig baseUrl: ${tsConfigInfo?.baseUrl ?? 'UNKNOWN'}`);

    // Create a custom transformer to rewrite the output paths
    const customTransformers: ts.CustomTransformers = {
        after: [
            context => {
                return sourceFile => {
                    // Only transform files that are not the entry point
                    if (sourceFile.fileName === inputPath) {
                        return sourceFile;
                    }
                    sourceFile.fileName = path.join(outputPath, path.basename(sourceFile.fileName));
                    return sourceFile;
                };
            },
        ],
    };

    const program = ts.createProgram([inputPath], compilerOptions);
    const emitResult = program.emit(undefined, undefined, undefined, undefined, customTransformers);

    // Only log actual emit errors, not type errors
    if (emitResult.emitSkipped) {
        for (const diagnostic of emitResult.diagnostics) {
            if (diagnostic.file && diagnostic.start !== undefined) {
                const { line, character } = ts.getLineAndCharacterOfPosition(
                    diagnostic.file,
                    diagnostic.start,
                );
                const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                logger.warn(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
            } else {
                logger.warn(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            }
        }
    }
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
