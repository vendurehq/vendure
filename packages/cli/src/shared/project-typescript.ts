import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import semver from 'semver';

import { resolvePackageJsonPath } from './cli-process-utils';

/**
 * The upgrade guide section on TypeScript 7.
 */
export const TYPESCRIPT_7_UPGRADE_GUIDE_URL =
    'https://docs.vendure.io/guides/developer-guide/updating/#typescript-7';

/**
 * Returns the version of the `typescript` package whose `tsc` `vendure build` runs for the
 * project. This uses the same resolution as the build (see `resolvePackageBin`), which falls
 * back to the CLI's own TypeScript when the project has none. It reads the version from the
 * resolved package.json rather than spawning `tsc --version`.
 *
 * Returns `undefined` if no `typescript` package can be found.
 */
export function getBuildTypeScriptVersion(projectDir: string): string | undefined {
    try {
        return readVersion(resolvePackageJsonPath('typescript', projectDir, ''));
    } catch {
        return undefined;
    }
}

/**
 * Returns the version of the `typescript` package installed in the project itself, without
 * falling back to the CLI's own TypeScript, or `undefined` if the project has none.
 */
export function getInstalledTypeScriptVersion(projectDir: string): string | undefined {
    try {
        const projectRequire = createRequire(path.join(projectDir, 'package.json'));
        return readVersion(projectRequire.resolve('typescript/package.json'));
    } catch {
        return undefined;
    }
}

/**
 * Whether a project that compiles with the given TypeScript version must have tsconfig files
 * that are valid for TypeScript 7. TypeScript 7 is recommended, but projects can stay on
 * TypeScript 5.x, which still accepts options such as `baseUrl`. An unknown version keeps the
 * checks, as the build then uses the CLI's own TypeScript 7.
 */
export function compilesWithTypeScript7(version: string | undefined): boolean {
    const parsed = version ? semver.coerce(version) : null;
    return parsed == null || parsed.major >= 7;
}

function readVersion(packageJsonPath: string): string {
    return (JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string }).version;
}
