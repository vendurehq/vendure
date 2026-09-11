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

const defaultPathAdapter: Required<Pick<PathAdapter, 'transformTsConfigPathMappings'>> = {
    transformTsConfigPathMappings: ({ patterns }) => patterns,
};

/** Minimal surface of `node:path` used by the path helpers, so tests can pass `path.win32`. */
type PathImpl = Pick<typeof path, 'relative' | 'resolve' | 'dirname' | 'isAbsolute' | 'sep'>;

/**
 * Whether `child` is `parent` itself or sits below it.
 *
 * Uses `path.relative` rather than comparing strings, so the platform's own
 * rules apply: on Windows that means case-insensitive matching and correct
 * handling of drive and UNC roots.
 */
function isWithin(parent: string, child: string, pathImpl: PathImpl = path): boolean {
    const relative = pathImpl.relative(parent, child);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(relative))
    );
}

/**
 * Deepest directory containing all of the given paths, or `undefined` when they
 * share no common root, as with different Windows drives.
 *
 * Walks up from the first path until it contains the rest, which keeps the
 * platform's path semantics in `path.relative` instead of restating them here.
 *
 * `pathImpl` is injectable so the Windows behaviour can be covered from any
 * platform; production callers use the default.
 */
export function commonAncestorDir(dirs: string[], pathImpl: PathImpl = path): string | undefined {
    if (dirs.length === 0) {
        return undefined;
    }
    let ancestor = pathImpl.resolve(dirs[0]);
    for (const dir of dirs.slice(1)) {
        const target = pathImpl.resolve(dir);
        while (!isWithin(ancestor, target, pathImpl)) {
            const parent = pathImpl.dirname(ancestor);
            if (parent === ancestor) {
                // Reached the root without containing `target`.
                return undefined;
            }
            ancestor = parent;
        }
    }
    return ancestor;
}

/**
 * The source root used when no explicit `pathAdapter.sourceRoot` is set: the
 * deepest directory containing the config and every local file it imports.
 *
 * For a config whose imports all sit alongside or below it, that is exactly its
 * own directory, so the layout is unchanged. It only widens when a collected
 * file lives above the config — otherwise the emit would produce a leading `..`
 * and write that file outside outputPath, past the package.json written there
 * to declare the output's module type.
 *
 * `pathImpl` is injectable so the multi-root failure can be exercised on any
 * platform; production callers use the default.
 */
export function resolveDefaultSourceRoot(
    configDir: string,
    importedDirs: string[],
    pathImpl: PathImpl = path,
): string {
    const resolvedRoot = commonAncestorDir([configDir, ...importedDirs], pathImpl);
    if (!resolvedRoot) {
        // Only reachable when the files span roots that share no ancestor,
        // such as two Windows drives. Falling back to the config directory
        // would guarantee an escape and report it as one, which says nothing
        // about the actual cause.
        throw new Error(
            `The Vendure config and the files it imports span multiple filesystem roots, so no common source root exists. ` +
                `Set pathAdapter.sourceRoot to the directory the compiled output should be relative to.`,
        );
    }
    return resolvedRoot;
}

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

const compileLocks = new Map<string, Promise<void>>();
let packageJsonWriteId = 0;

/**
 * Compiles TypeScript files and discovers Vendure plugins in both the compiled output
 * and in node_modules.
 */
export async function compile(options: CompilerOptions): Promise<CompileResult> {
    return withCompileLock(path.resolve(options.outputPath), () => compileInternal(options));
}

async function withCompileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Serialize every compile for the same output path; callers that need
    // last-one-wins behavior should debounce before calling compile().
    const previous = compileLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
        release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);

    compileLocks.set(key, queued);
    await previous.catch(() => undefined);

    try {
        return await fn();
    } finally {
        release();
        if (compileLocks.get(key) === queued) {
            compileLocks.delete(key);
        }
    }
}

async function compileInternal(options: CompilerOptions): Promise<CompileResult> {
    const { vendureConfigPath, outputPath, pathAdapter, logger = noopLogger, pluginPackageScanner } = options;
    const transformTsConfigPathMappings =
        pathAdapter?.transformTsConfigPathMappings ?? defaultPathAdapter.transformTsConfigPathMappings;

    // 0. Clear the outputPath
    fs.removeSync(outputPath);

    // 1. Compile TypeScript files
    const compileStart = Date.now();
    const { sourceRoot, tsConfigInfo, sourceFiles } = await resolveSourceContext(
        vendureConfigPath,
        pathAdapter?.sourceRoot,
        logger,
    );
    await compileTypeScript({
        outputPath,
        sourceRoot,
        tsConfigInfo,
        sourceFiles,
        logger,
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
    // Note: configFileName is kept as the basename to preserve the public API contract.
    // Custom pathAdapter implementations (e.g. in monorepos) rely on this being just
    // the filename, not a relative path — they hardcode the directory structure themselves.
    const configFileName = path.basename(vendureConfigPath);
    // A custom adapter owns its own layout, so it keeps deciding where the config
    // is. The default follows the emit: that is the config's path relative to the
    // resolved source root, which is the bare filename unless the root widened to
    // keep an upward import inside outputPath.
    const compiledConfigPath = pathAdapter?.getCompiledConfigPath
        ? pathAdapter.getCompiledConfigPath({
              inputRootDir: path.dirname(vendureConfigPath),
              outputPath,
              configFileName,
          })
        : path.join(outputPath, path.relative(sourceRoot, vendureConfigPath));
    const compiledConfigFilePath = pathToFileURL(compiledConfigPath).href.replace(/\.ts$/, '.js');

    await writePackageJson(outputPath, options.module);

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
        sourceRoot,
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

async function writePackageJson(outputPath: string, module?: 'commonjs' | 'esm'): Promise<void> {
    const packageJsonPath = path.join(outputPath, 'package.json');
    const tempPackageJsonPath = path.join(
        outputPath,
        `.package-${process.pid}-${Date.now()}-${packageJsonWriteId++}.json`,
    );

    await fs.writeFile(
        tempPackageJsonPath,
        JSON.stringify({ type: module === 'esm' ? 'module' : 'commonjs', private: true }, null, 2),
    );
    await fs.rename(tempPackageJsonPath, packageJsonPath);
}

/**
 * Resolves the source root the compiled output is laid out relative to, and
 * returns everything `compileTypeScript` needs so each step runs exactly once.
 *
 * An explicit `pathAdapter.sourceRoot` wins unchanged. The default is computed
 * by `resolveDefaultSourceRoot` from the config directory and every directory
 * collected from its import tree.
 */
async function resolveSourceContext(
    inputPath: string,
    customSourceRoot: string | undefined,
    logger: Logger,
): Promise<{
    sourceRoot: string;
    tsConfigInfo?: { baseUrl: string; paths: Record<string, string[]> };
    sourceFiles: string[];
}> {
    // Find tsconfig paths for resolving path aliases in the import tree
    const originalTsConfigInfo = await findTsConfigPaths(
        inputPath,
        logger,
        'compiling',
        ({ patterns }) => patterns, // No transformation - use original paths
    );

    logger.debug(`tsConfig paths: ${JSON.stringify(originalTsConfigInfo?.paths, null, 2)}`);
    logger.debug(`tsConfig baseUrl: ${originalTsConfigInfo?.baseUrl ?? 'UNKNOWN'}`);

    // Collect all local source files by walking the import tree
    const collectStart = Date.now();
    const { sourceFiles, skippedPackageJsonFiles } = await collectLocalSourceFiles(
        inputPath,
        originalTsConfigInfo,
    );
    logger.debug(`Collected ${sourceFiles.length} source files in ${Date.now() - collectStart}ms`);

    // The import stays in the emitted JavaScript, so leaving this silent means the
    // config fails to load with a bare "Cannot find module" naming a file the author
    // can see on disk.
    if (skippedPackageJsonFiles.length) {
        logger.warn(
            `A package.json cannot be copied into the compiled config output, because its "type" field ` +
                `decides how the compiled files beside it are loaded. Loading the config will fail on ` +
                `${skippedPackageJsonFiles.join(', ')}. Read the file at runtime instead of importing it.`,
        );
    }

    let sourceRoot = customSourceRoot;
    if (!sourceRoot) {
        sourceRoot = resolveDefaultSourceRoot(
            path.dirname(inputPath),
            sourceFiles.map(file => path.dirname(file)),
        );
    }
    if (customSourceRoot) {
        // An explicit root is the adapter author's deliberate layout choice,
        // not a widening the compiler decided — report it without alarm.
        logger.debug(`Using sourceRoot from pathAdapter: ${sourceRoot}`);
    } else if (path.relative(sourceRoot, path.dirname(inputPath)) !== '') {
        // Widening keeps an upward import inside outputPath (#5086), but it
        // also moves the config off the output root. Surface that layout
        // change rather than letting users discover it in the emitted tree.
        logger.warn(
            `Source root widened to "${sourceRoot}" so every file the config imports stays inside outputPath.`,
        );
    } else {
        logger.debug(`Resolved source root: ${sourceRoot}`);
    }

    return { sourceRoot, tsConfigInfo: originalTsConfigInfo, sourceFiles };
}

/**
 * Compiles TypeScript files to JavaScript using per-file transpilation, and copies
 * across the JSON they import.
 *
 * Instead of using `ts.createProgram()` (which resolves all imports including
 * node_modules type definitions and can OOM on projects with heavy dependencies),
 * this function:
 * 1. Transpiles each given TypeScript file individually with `ts.transpileModule()`
 *    (no type resolution), and copies JSON through unchanged
 * 2. Validates every emit lands inside outputPath before writing anything
 *
 * This avoids loading massive `.d.ts` files from packages like `openai`, `ai`, etc.
 * See: https://github.com/vendurehq/vendure/issues/4559
 */
async function compileTypeScript({
    outputPath,
    logger,
    module,
    sourceRoot,
    tsConfigInfo,
    sourceFiles,
}: {
    outputPath: string;
    logger: Logger;
    module: 'commonjs' | 'esm';
    sourceRoot: string;
    tsConfigInfo?: { baseUrl: string; paths: Record<string, string[]> };
    sourceFiles: string[];
}): Promise<void> {
    await fs.ensureDir(outputPath);

    const afterTransformers: Array<ts.TransformerFactory<ts.SourceFile>> = [];

    // Build path transformer for ESM mode
    // This is necessary because tsconfig-paths.register() only works for CommonJS require(),
    // not for ESM import(). We need to transform the import paths during transpilation.
    if (module === 'esm' && tsConfigInfo) {
        logger.debug('Adding path transformer for ESM mode');
        afterTransformers.push(
            createPathTransformer({
                baseUrl: tsConfigInfo.baseUrl,
                paths: tsConfigInfo.paths,
            }),
        );
    }

    // Copying the JSON is enough for CommonJS, whose require() reads it directly.
    // ESM emits the import unchanged, and Node refuses to load a JSON module
    // without a `with { type: 'json' }` attribute, which the author cannot write
    // in a source file that also targets CommonJS for the server build.
    if (module === 'esm') {
        afterTransformers.push(createJsonImportAttributeTransformer());
    }

    // Note: emitDecoratorMetadata with transpileModule emits `Object` for all
    // imported types since there is no type resolver. This is acceptable because
    // the compiled output is only used for config loading and plugin discovery,
    // not for runtime dependency injection.
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: module === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
        // Plugin import graphs can transitively reach .tsx files (e.g. server-side
        // React for PDF or email rendering). Without this, transpileModule emits raw
        // JSX into the .js output and the compiled config fails to import.
        jsx: ts.JsxEmit.ReactJSX,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
    };
    const transformers: ts.CustomTransformers | undefined = afterTransformers.length
        ? { after: afterTransformers }
        : undefined;

    // Transpile first and validate every destination before writing anything,
    // so a rejected compile cannot leave partially written output behind.
    interface PendingEmit {
        sourceFile: string;
        outputFilePath: string;
        outputText: string;
    }
    const pendingEmits: PendingEmit[] = [];

    for (const filePath of sourceFiles) {
        const content = await fs.readFile(filePath, 'utf-8');
        // JSON is data, not code: it is copied byte for byte so the require() or
        // import in the emitted JavaScript resolves against the same content the
        // server would have read.
        const outputText = filePath.endsWith('.json')
            ? content
            : ts.transpileModule(content, {
                  compilerOptions,
                  fileName: filePath,
                  transformers,
              }).outputText;

        // Compute output path preserving directory structure relative to source root
        const relativePath = path.relative(sourceRoot, filePath);
        const outputFilePath = path.join(outputPath, relativePath).replace(/\.tsx?$/, '.js');

        pendingEmits.push({ sourceFile: filePath, outputFilePath, outputText });
    }

    for (const emit of pendingEmits) {
        assertWithinOutputPath(emit.outputFilePath, outputPath);
    }

    for (const emit of pendingEmits) {
        await fs.ensureDir(path.dirname(emit.outputFilePath));
        await fs.writeFile(emit.outputFilePath, emit.outputText);
    }
}

/**
 * Adds `with { type: 'json' }` to import and export declarations of `.json`
 * specifiers that do not already carry import attributes.
 *
 * Matching on the `.json` suffix is a superset of the rule `collectLocalSourceFiles`
 * uses to copy a JSON file. Bare specifiers such as `some-pkg/data.json` are never
 * copied, but still get the attribute, because Node requires it for them too.
 */
function createJsonImportAttributeTransformer(): ts.TransformerFactory<ts.SourceFile> {
    return context => {
        const { factory } = context;
        const jsonAttributes = () =>
            factory.createImportAttributes(
                factory.createNodeArray([
                    factory.createImportAttribute(
                        factory.createIdentifier('type'),
                        factory.createStringLiteral('json'),
                    ),
                ]),
            );
        const needsJsonAttributes = (node: ts.ImportDeclaration | ts.ExportDeclaration) =>
            !node.attributes &&
            !!node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            node.moduleSpecifier.text.endsWith('.json');

        const visitor: ts.Visitor = node => {
            if (ts.isImportDeclaration(node) && needsJsonAttributes(node)) {
                return factory.updateImportDeclaration(
                    node,
                    node.modifiers,
                    node.importClause,
                    node.moduleSpecifier,
                    jsonAttributes(),
                );
            }
            if (ts.isExportDeclaration(node) && needsJsonAttributes(node)) {
                return factory.updateExportDeclaration(
                    node,
                    node.modifiers,
                    node.isTypeOnly,
                    node.exportClause,
                    node.moduleSpecifier,
                    jsonAttributes(),
                );
            }
            return node;
        };

        return sourceFile => ts.visitEachChild(sourceFile, visitor, context);
    };
}

function assertWithinOutputPath(outputFilePath: string, outputPath: string): void {
    // An emit outside outputPath escapes the package.json written there to
    // declare the module type, and Node then resolves the file against the
    // enclosing project instead. Fail here rather than at config load, where
    // it surfaces as an unrelated "exports is not defined" error.
    //
    // `isWithin` compares via path.relative against a segment boundary, so a
    // file whose own name begins with dots is not mistaken for an escape.
    if (!isWithin(outputPath, outputFilePath)) {
        throw new Error(
            `"${outputFilePath}" is outside the output directory "${outputPath}". ` +
                `Set pathAdapter.sourceRoot to a directory containing every file the config imports.`,
        );
    }
}

/**
 * Collects all local source files reachable from the entry point by following
 * import/export declarations, along with the JSON files they import. Only follows
 * local imports (relative paths and tsconfig path aliases), not npm package
 * imports.
 *
 * This is intentionally lightweight — it uses TypeScript's AST parser only
 * for reading import statements, without any module resolution or type loading.
 */
async function collectLocalSourceFiles(
    entryFile: string,
    tsConfigInfo?: { baseUrl: string; paths: Record<string, string[]> },
): Promise<{ sourceFiles: string[]; skippedPackageJsonFiles: string[] }> {
    const visited = new Set<string>();
    const skippedPackageJson = new Set<string>();

    async function processFile(filePath: string) {
        const resolved = await resolveSourceFile(filePath);
        if (!resolved) return;

        // Skip declaration files and non-source files before adding to visited,
        // so they don't leak into the returned sourceFiles array.
        if (resolved.endsWith('.d.ts') || resolved.endsWith('.d.tsx')) return;
        if (!/\.(ts|tsx|js|jsx|json)$/.test(resolved)) return;
        // A package.json is never copied. At the output root it would collide with
        // the one written there to declare the module type, and in any nested
        // directory its own "type" field decides how the compiled .js files beside
        // it are loaded, which breaks them.
        if (path.basename(resolved) === 'package.json') {
            skippedPackageJson.add(resolved);
            return;
        }

        if (visited.has(resolved)) return;
        visited.add(resolved);

        // JSON is copied verbatim and declares no imports, so there is nothing to
        // parse or follow.
        if (resolved.endsWith('.json')) return;

        const content = await fs.readFile(resolved, 'utf-8');
        const sf = ts.createSourceFile(resolved, content, ts.ScriptTarget.Latest, true);
        const dir = path.dirname(resolved);
        const importsToFollow: string[] = [];

        ts.forEachChild(sf, node => {
            if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
            if (isTypeOnlyImportOrExport(node)) return;
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
    return { sourceFiles: [...visited], skippedPackageJsonFiles: [...skippedPackageJson] };
}

function isTypeOnlyImportOrExport(node: ts.ImportDeclaration | ts.ExportDeclaration) {
    if (ts.isImportDeclaration(node)) {
        const importClause = node.importClause;
        if (!importClause) {
            return false;
        }
        if (importClause.isTypeOnly) {
            return true;
        }
        const namedBindings = importClause.namedBindings;
        return (
            !importClause.name &&
            !!namedBindings &&
            ts.isNamedImports(namedBindings) &&
            namedBindings.elements.length > 0 &&
            namedBindings.elements.every(element => element.isTypeOnly)
        );
    }

    if (node.isTypeOnly) {
        return true;
    }
    return (
        !!node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every(element => element.isTypeOnly)
    );
}

async function registerTsConfigPaths(options: {
    outputPath: string;
    sourceRoot: string;
    configPath: string;
    logger: Logger;
    phase: 'compiling' | 'loading';
    transformTsConfigPathMappings: Required<PathAdapter>['transformTsConfigPathMappings'];
}) {
    const { outputPath, sourceRoot, configPath, logger, phase, transformTsConfigPathMappings } = options;
    const tsConfigInfo = await findTsConfigPaths(configPath, logger, phase, transformTsConfigPathMappings);
    if (tsConfigInfo) {
        // Path patterns resolve relative to the tsconfig's own baseUrl, but the
        // runtime registration points imports at the emit root. Re-express the
        // baseUrl in emitted coordinates so a widened root (#5086) keeps
        // aliases pointing at the same files: with `<root>/src/tsconfig.json`
        // using baseUrl "." and the root widened to `<root>`, aliases must
        // resolve against `<outputPath>/src`, not `<outputPath>`.
        const emittedBaseUrl = isWithin(sourceRoot, tsConfigInfo.baseUrl)
            ? path.join(outputPath, path.relative(sourceRoot, tsConfigInfo.baseUrl))
            : outputPath;
        const params: RegisterParams = {
            baseUrl: emittedBaseUrl,
            paths: tsConfigInfo.paths,
        };
        logger.debug(`Registering tsconfig paths: ${JSON.stringify(params, null, 2)}`);
        tsConfigPaths.register(params);
    }
}
