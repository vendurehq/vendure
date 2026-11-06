import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Diagnostic, ParsedCommandLine } from 'typescript/sync';
import {
    API,
    DiagnosticCategory,
    formatDiagnostics,
    formatDiagnosticsWithColorAndContext,
} from 'typescript/sync';

/**
 * Explains how to fix the most common tsconfig errors when upgrading a Vendure v3 project.
 */
export const TSCONFIG_MIGRATION_HINT =
    'To upgrade a tsconfig to TypeScript 7: remove "baseUrl" (paths are now resolved relative to the ' +
    'tsconfig file), set "rootDir" (e.g. "./src") when "outDir" is set, and replace ' +
    '"moduleResolution": "node" with "nodenext" or "bundler". See https://aka.ms/ts6 for details.';

const NO_INPUTS_FOUND_ERROR_CODE = 18003;

let sharedApi: API | undefined;

/**
 * Returns a lazily-created instance of the TypeScript 7 API. Creating it spawns the native
 * `tsgo` process, which does not keep the Node.js process alive, so the instance is shared
 * for the lifetime of the process.
 */
export function getTypeScriptApi(): API {
    if (!sharedApi) {
        sharedApi = new API({ cwd: process.cwd() });
    }
    return sharedApi;
}

/**
 * Reads and parses a tsconfig file, following `extends`. Option values in the result use
 * the numeric enum form (e.g. `module: 1`), and paths such as `outDir` are absolute.
 *
 * Note that this only reports syntax errors in the config file. Options which TypeScript 7
 * no longer supports (e.g. `baseUrl`) are only reported by {@link getTsConfigProgramErrors}.
 */
export function parseTsConfigFile(tsconfigPath: string): ParsedCommandLine {
    const absolutePath = path.resolve(tsconfigPath);
    if (!existsSync(absolutePath)) {
        throw new Error(`Could not find TypeScript config file: ${tsconfigPath}`);
    }
    const api = getTypeScriptApi();
    const readResult = api.readConfigFile(absolutePath);
    if (readResult.error) {
        throw new Error(formatTsDiagnostics([readResult.error]));
    }
    const parsed = api.parseConfigFile(absolutePath);
    // TS18003 ("No inputs were found in config file") does not affect the compiler options,
    // e.g. when transpiling files outside of a solution-style tsconfig's `include`.
    const errors = (parsed.errors ?? []).filter(error => error.code !== NO_INPUTS_FOUND_ERROR_CODE);
    if (errors.length) {
        throw new Error(formatTsDiagnostics(errors));
    }
    return parsed;
}

/**
 * Returns the errors that `tsc` would report for the tsconfig file itself before
 * compiling anything, such as removed options (TS5102, e.g. `baseUrl`), removed option
 * values (TS5108, e.g. `moduleResolution: "node"`) and a missing `rootDir` (TS5011).
 *
 * This loads the project (but does not type-check it), so it is slower than
 * {@link parseTsConfigFile}.
 */
export function getTsConfigProgramErrors(tsconfigPath: string): Diagnostic[] {
    const absolutePath = path.resolve(tsconfigPath);
    const snapshot = getTypeScriptApi().createSnapshot({ openProjects: [absolutePath] });
    try {
        const project =
            snapshot.getProjects().find(p => p.configFileName === absolutePath) ?? snapshot.getProjects()[0];
        if (!project) {
            return [];
        }
        return project.program.getProgramDiagnostics().filter(isErrorDiagnostic);
    } finally {
        snapshot.dispose();
    }
}

/**
 * Returns true for diagnostics of the "error" category. The API types `category` as a plain
 * number, so it is compared with the numeric value of the enum.
 */
export function isErrorDiagnostic(diagnostic: Diagnostic): boolean {
    return diagnostic.category === Number(DiagnosticCategory.Error);
}

/**
 * Whether output written to the given stream should use colours. Follows the same conventions
 * as Node.js itself: `FORCE_COLOR` (other than "0" or "false") forces colours on and takes
 * precedence over `NO_COLOR` and `NODE_DISABLE_COLORS`, which turn them off. Otherwise colours
 * are only used when the stream is a TTY.
 */
export function shouldUseColor(
    stream: { isTTY?: boolean } = process.stderr,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const forceColor = env.FORCE_COLOR;
    if (forceColor !== undefined) {
        return forceColor !== '0' && forceColor.toLowerCase() !== 'false';
    }
    if (env.NO_COLOR !== undefined || env.NODE_DISABLE_COLORS !== undefined) {
        return false;
    }
    return stream.isTTY === true;
}

/**
 * Formats TypeScript diagnostics. By default, colours and source context are used according
 * to {@link shouldUseColor} for stderr, so logs and CI output contain no ANSI escape codes
 * unless colours are forced. Pass `color: false` for output that is never shown in a terminal,
 * such as JSON reports.
 */
export function formatTsDiagnostics(
    diagnostics: readonly Diagnostic[],
    options: { color?: boolean } = {},
): string {
    const color = options.color ?? shouldUseColor();
    return color
        ? formatDiagnosticsWithColorAndContext(diagnostics, getTypeScriptApi())
        : formatDiagnostics(diagnostics, getTypeScriptApi());
}
