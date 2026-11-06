import { TYPESCRIPT_VERSION_RANGE } from '@vendure/common/lib/shared-constants';
import { existsSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { ScriptTarget } from 'typescript/ast';
import type { CompilerOptions } from 'typescript/sync';

import {
    compilesWithTypeScript7,
    getBuildTypeScriptVersion,
    getInstalledTypeScriptVersion,
    TYPESCRIPT_7_UPGRADE_GUIDE_URL,
} from '../../../shared/project-typescript';
import {
    formatTsDiagnostics,
    getTsConfigProgramErrors,
    parseTsConfigFile,
    TSCONFIG_MIGRATION_HINT,
} from '../../../shared/typescript-api';
import { resolveVendureProjectDirectory } from '../../dev/dev';
import { CheckResult } from '../types';

/**
 * The tsconfig files used by `vendure build` (see the build command's tsconfig discovery).
 */
const TSCONFIG_CANDIDATES = [
    'tsconfig.json',
    'tsconfig.server.json',
    'tsconfig.worker.json',
    'tsconfig.build.json',
];

const INSTALL_HINT = `Install it with e.g. npm install -D "typescript@${TYPESCRIPT_VERSION_RANGE}".`;

/**
 * Checks that the project's tsconfig files work with TypeScript 7, which Vendure v4 recommends.
 * TypeScript 7 rejects options that Vendure v3 projects commonly use, such as `baseUrl` and
 * `moduleResolution: "node"`, and requires an explicit `rootDir` when `outDir` is set and the
 * sources are in a subdirectory. Such tsconfig files fail the check when the project compiles
 * with TypeScript 7, as `vendure build` would fail too. Projects that stay on TypeScript 5.x can
 * still build, so for them the check only warns.
 *
 * It also warns when the installed TypeScript version is not in the recommended range, and
 * when a tsconfig enables `useDefineForClassFields`, which breaks Vendure entities.
 */
export function runTypeScriptCheck(cwd: string = process.cwd()): CheckResult {
    let projectDir: string;
    try {
        projectDir = resolveVendureProjectDirectory(cwd);
    } catch (e) {
        // e.g. several Vendure projects in a workspace. The check cannot tell which project
        // to inspect, so skip it rather than throwing, and the rest of the report still runs.
        return {
            name: 'TypeScript',
            status: 'skip',
            message: `Skipped: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
    const details: string[] = [];
    const warnings: string[] = [];

    const installedVersion = getInstalledTypeScriptVersion(projectDir);
    // The TypeScript whose tsc `vendure build` runs: the project's own, or the CLI's as a fallback
    const buildVersion = getBuildTypeScriptVersion(projectDir);
    const requiresTypeScript7Config = compilesWithTypeScript7(buildVersion);
    if (!installedVersion) {
        warnings.push('TypeScript is not installed');
        details.push(`The "typescript" package is not installed. ${INSTALL_HINT}`);
    } else if (!compilesWithTypeScript7(installedVersion)) {
        warnings.push(`TypeScript ${installedVersion} is installed; TypeScript 7 is recommended`);
        details.push(
            `TypeScript ${installedVersion} is installed. Vendure v4 still builds projects on TypeScript 5.x, ` +
                `but recommends "${TYPESCRIPT_VERSION_RANGE}"; \`vendure build\` skips its TypeScript 7 ` +
                `tsconfig checks. ${INSTALL_HINT} See ${TYPESCRIPT_7_UPGRADE_GUIDE_URL}`,
        );
    } else if (!semver.satisfies(installedVersion, TYPESCRIPT_VERSION_RANGE)) {
        warnings.push(`TypeScript ${installedVersion} is not supported`);
        details.push(
            `TypeScript ${installedVersion} is installed, but Vendure supports "${TYPESCRIPT_VERSION_RANGE}". ` +
                INSTALL_HINT,
        );
    } else {
        details.push(`TypeScript ${installedVersion}`);
    }

    const tsconfigPaths = TSCONFIG_CANDIDATES.map(file => path.join(projectDir, file)).filter(file =>
        existsSync(file),
    );
    if (!tsconfigPaths.length) {
        return {
            name: 'TypeScript',
            status: 'fail',
            message: `No tsconfig.json found in ${projectDir}`,
            details,
        };
    }

    const incompatible: string[] = [];
    for (const tsconfigPath of tsconfigPaths) {
        const relativePath = path.relative(cwd, tsconfigPath) || tsconfigPath;
        try {
            const errors = getTsConfigProgramErrors(tsconfigPath);
            if (errors.length) {
                incompatible.push(relativePath);
                // Plain formatting: the details are also emitted in the JSON report
                details.push(`${relativePath}:`, formatTsDiagnostics(errors, { color: false }).trim());
            } else {
                details.push(`${relativePath} is compatible with TypeScript 7`);
            }
            // Also checked for tsconfig files that TypeScript 7 rejects: a project that stays on
            // TypeScript 5.x still builds with them, and is affected in the same way.
            if (usesDefineForClassFields(parseTsConfigFile(tsconfigPath).options, buildVersion)) {
                warnings.push(`${relativePath} enables useDefineForClassFields`);
                details.push(
                    `${relativePath} enables "useDefineForClassFields" (explicitly, or through a "target" of ` +
                        'ES2022 or later, which is also the default in TypeScript 7). Then fields declared on ' +
                        'entity subclasses are reset after the constructor runs, so e.g. new MyEntity(input) ' +
                        'loses its input. Set "useDefineForClassFields": false.',
                );
            }
        } catch (e) {
            incompatible.push(relativePath);
            details.push(`${relativePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (incompatible.length) {
        details.push(TSCONFIG_MIGRATION_HINT);
        if (requiresTypeScript7Config) {
            // `vendure build` would fail on these, as the project compiles with TypeScript 7
            return {
                name: 'TypeScript',
                status: 'fail',
                message: `${incompatible.join(', ')} not compatible with TypeScript 7`,
                details,
            };
        }
        warnings.push(`${incompatible.join(', ')} need changes before upgrading to TypeScript 7`);
    }

    return {
        name: 'TypeScript',
        status: warnings.length ? 'warn' : 'pass',
        message: warnings.length ? warnings.join('; ') : 'tsconfig files are compatible with TypeScript 7',
        details,
    };
}

/**
 * Whether the compiler options make class fields use [[Define]] semantics. When the
 * option is not set, TypeScript enables it for a target of ES2022 or later. Without a
 * `target`, TypeScript 7 defaults to a target later than ES2022, and TypeScript 5.x to ES5.
 *
 * @param typescriptVersion - the version of the TypeScript that compiles the project.
 *   Unknown versions are treated as TypeScript 7.
 */
export function usesDefineForClassFields(options: CompilerOptions, typescriptVersion?: string): boolean {
    if (options.useDefineForClassFields != null) {
        return options.useDefineForClassFields;
    }
    if (options.target == null) {
        return compilesWithTypeScript7(typescriptVersion);
    }
    return Number(options.target) >= Number(ScriptTarget.ES2022);
}
