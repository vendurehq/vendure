import { existsSync, readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { register as registerTsConfigPaths } from 'tsconfig-paths';
import type { CompilerOptions } from 'typescript/sync';
import { JsxEmit, ModuleKind } from 'typescript/sync';

import {
    formatTsDiagnostics,
    getTypeScriptApi,
    isErrorDiagnostic,
    parseTsConfigFile,
} from './typescript-api';

export interface RegisterTypeScriptOptions {
    /**
     * Path to the tsconfig file whose compiler options (decorators, target, `paths`, etc.)
     * should be used. Defaults to the `VENDURE_TSCONFIG` env var, then the nearest
     * `tsconfig.json` to the current working directory.
     */
    tsconfigPath?: string;
}

const REGISTERED = Symbol.for('vendure.typescript.register');
const TS_EXTENSIONS = ['.ts', '.cts', '.tsx'] as const;

/**
 * Compiler options that are irrelevant (or harmful) when transpiling a single file
 * into CommonJS for immediate execution.
 */
const STRIPPED_COMPILER_OPTIONS = [
    'baseUrl',
    'composite',
    'configFilePath',
    'declaration',
    'declarationDir',
    'declarationMap',
    'emitDeclarationOnly',
    'incremental',
    'inlineSourceMap',
    'inlineSources',
    'lib',
    'moduleDetection',
    'moduleResolution',
    'noEmit',
    'outDir',
    'outFile',
    'paths',
    'pathsBasePath',
    'plugins',
    'rootDir',
    'rootDirs',
    'sourceMap',
    'tsBuildInfoFile',
    'typeRoots',
    'types',
    'verbatimModuleSyntax',
];

/**
 * Returns true if TypeScript files are already being transpiled on the fly in this
 * process, either by this module's hook or by ts-node.
 */
export function isTypeScriptRegistered(): boolean {
    const proc = process as unknown as Record<symbol, unknown>;
    return proc[REGISTERED] != null || proc[Symbol.for('ts-node.register.instance')] != null;
}

/**
 * Installs a CommonJS require hook that transpiles `.ts`, `.cts` and `.tsx` files with the
 * TypeScript 7 API. This replaces `ts-node`, which cannot run on TypeScript 7.
 *
 * Like ts-node's `transpileOnly` mode, files are transpiled in isolation without
 * type-checking. `emitDecoratorMetadata` is honoured, which Vendure relies on.
 * `paths` from the tsconfig are registered with tsconfig-paths.
 */
export function registerTypeScript(options: RegisterTypeScriptOptions = {}): void {
    if (isTypeScriptRegistered()) {
        return;
    }
    const tsconfigPath =
        options.tsconfigPath ?? process.env.VENDURE_TSCONFIG ?? findNearestTsConfig(process.cwd());
    if (!tsconfigPath) {
        process.emitWarning(
            `No tsconfig.json found in ${process.cwd()} or its parent directories. ` +
                'TypeScript files will be compiled with default options (decorators enabled). ' +
                'Set the VENDURE_TSCONFIG env var to use a specific tsconfig file.',
            { code: 'VENDURE_TSCONFIG_NOT_FOUND' },
        );
    }
    const parsedOptions: CompilerOptions = tsconfigPath ? parseTsConfigFile(tsconfigPath).options : {};
    const compilerOptions = getTranspileCompilerOptions(parsedOptions);
    const api = getTypeScriptApi();

    const extensions = (Module as unknown as { _extensions: Record<string, ModuleLoader> })._extensions;
    const jsLoader = extensions['.js'];
    for (const ext of TS_EXTENSIONS) {
        const previousLoader = extensions[ext];
        extensions[ext] = (module, filename) => {
            if (filename.split(path.sep).includes('node_modules')) {
                return (previousLoader ?? jsLoader)(module, filename);
            }
            const source = readFileSync(filename, 'utf-8');
            const result = api.transpileModule(source, {
                fileName: filename,
                compilerOptions: {
                    ...compilerOptions,
                    ...(ext === '.tsx' && compilerOptions.jsx == null ? { jsx: JsxEmit.ReactJSX } : {}),
                },
                reportDiagnostics: true,
            });
            const errors = (result.diagnostics ?? []).filter(d => isErrorDiagnostic(d) && d.fileName);
            if (errors.length) {
                throw new Error(formatTsDiagnostics(errors));
            }
            (module as unknown as CompilableModule)._compile(result.outputText, filename);
        };
    }

    const pathMappings = tsconfigPath ? getTsConfigPathMappings(tsconfigPath, parsedOptions) : undefined;
    if (pathMappings) {
        registerTsConfigPaths(pathMappings);
    }

    process.setSourceMapsEnabled(true);
    (process as unknown as Record<symbol, unknown>)[REGISTERED] = { tsconfigPath };
}

/**
 * Returns the `paths` of a tsconfig and the directory they are resolved from, in the form
 * expected by tsconfig-paths. Like TypeScript 7, `paths` are resolved relative to the
 * tsconfig file that declares them, which may be a config that this one `extends`.
 */
export function getTsConfigPathMappings(
    tsconfigPath: string,
    parsedOptions: CompilerOptions = parseTsConfigFile(tsconfigPath).options,
): { baseUrl: string; paths: Record<string, string[]> } | undefined {
    if (!parsedOptions.paths) {
        return undefined;
    }
    const pathsBasePath = (parsedOptions as Record<string, unknown>).pathsBasePath as string | undefined;
    return {
        baseUrl: pathsBasePath ?? path.dirname(path.resolve(tsconfigPath)),
        paths: parsedOptions.paths,
    };
}

/**
 * Turns the compiler options of a tsconfig into the options used to transpile each file.
 *
 * Vendure relies on legacy decorators with metadata (NestJS dependency injection and
 * TypeORM column types), so `experimentalDecorators` and `emitDecoratorMetadata` default
 * to `true` unless the tsconfig sets them explicitly. Without them, decorators would
 * compile to the TC39 standard form and `design:paramtypes` would silently be missing.
 */
export function getTranspileCompilerOptions(options: CompilerOptions): CompilerOptions {
    const result: Record<string, unknown> = { ...options };
    for (const key of STRIPPED_COMPILER_OPTIONS) {
        delete result[key];
    }
    return {
        ...result,
        experimentalDecorators: options.experimentalDecorators ?? true,
        emitDecoratorMetadata: options.emitDecoratorMetadata ?? true,
        // TypeScript 7's default target is newer than ES2022, which makes class fields use
        // [[Define]] semantics. Then a subclass's declared fields are reset to undefined after
        // super() returns, so e.g. the constructor input of a VendureEntity subclass is lost.
        useDefineForClassFields: options.useDefineForClassFields ?? false,
        // The TypeScript API only accepts numeric enum values for compiler options.
        module: ModuleKind.CommonJS,
        inlineSourceMap: true,
        inlineSources: true,
    };
}

/**
 * Returns the path of the nearest `tsconfig.json` in `startDir` or its ancestors.
 */
export function findNearestTsConfig(startDir: string): string | undefined {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, 'tsconfig.json');
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

type ModuleLoader = (module: NodeModule, filename: string) => void;
type CompilableModule = { _compile(code: string, filename: string): void };
