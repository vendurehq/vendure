import {
    CREATE_RECORD_VERSION,
    CreateRecord,
    CreateRecordPackageManager,
} from '@vendure/common/lib/create-record';
import Handlebars from 'handlebars';

import {
    CLOUD_PACKAGE_RANGE,
    CONCURRENTLY_VERSION,
    DEFAULT_PROJECT_VERSION,
    IOREDIS_VERSION,
    PG_VERSION,
    SELF_HOSTING_GUIDE_URL,
    SERVER_PORT,
    STOREFRONT_PORT,
    TS_NODE_VERSION,
    TYPEORM_VERSION,
    TYPES_NODE_VERSION,
    TYPESCRIPT_VERSION,
    VITE_VERSION,
} from './constants.js';
import { getPackageManagerInfo, PackageManagerInfo } from './package-manager.js';
import { FeatureSetDefinition } from './registries.js';
import { StorefrontStarter } from './storefront-starters.js';
import { CreateOptions } from './types.js';

/**
 * The files create writes, as pure functions of the options. Nothing here touches the file
 * system, so the specs can check the output directly.
 */

/** The workspace directory of the server in a project with a storefront. */
export const SERVER_WORKSPACE_DIR = 'apps/server';
export const STOREFRONT_WORKSPACE_DIR = 'apps/storefront';

/**
 * Dependencies whose install or build scripts must run. npm (v12+), pnpm (v10+), yarn (v4.14+)
 * and bun block dependency build scripts unless they are allowlisted. `bcrypt` comes from
 * `@vendure/core`, `esbuild` from `vite`, and `sharp` from the asset handling.
 */
export const NATIVE_BUILD_DEPENDENCIES = ['bcrypt', 'esbuild', 'sharp'];

/** A package name from the directory name: lowercase, with npm's allowed characters only. */
export function toPackageName(directoryName: string): string {
    const name = directoryName
        .toLowerCase()
        .replace(/[^a-z0-9._~-]+/g, '-')
        .replace(/^[._-]+/, '')
        .replace(/-+$/, '');
    return name || 'vendure-app';
}

export interface ServerPackageJsonInput {
    name: string;
    vendureVersion: string;
    packageManager: CreateRecordPackageManager;
    features: readonly FeatureSetDefinition[];
    scenario: CreateOptions['scenario'];
    /** Whether this is the whole project, which carries the build-script allowlist itself. */
    isRoot: boolean;
}

export function getServerPackageJson(input: ServerPackageJsonInput): Record<string, unknown> {
    const vendure = input.vendureVersion;
    const dependencies: Record<string, string> = {
        // `@vendure/cloud` imports it when it loads, although it declares it an optional peer.
        '@vendure/asset-server-plugin': vendure,
        '@vendure/cloud': CLOUD_PACKAGE_RANGE,
        '@vendure/core': vendure,
        '@vendure/mcp-plugin': vendure,
        // Generated migrations import from `typeorm`. Only pnpm's strict node_modules fails to
        // resolve it as a transitive dependency, so it is declared for pnpm only.
        ...(input.packageManager === 'pnpm' ? { typeorm: TYPEORM_VERSION } : {}),
    };
    for (const featureSet of input.features) {
        Object.assign(dependencies, featureSet.dependencies);
    }
    const devDependencies: Record<string, string> = {
        '@types/node': TYPES_NODE_VERSION,
        '@vendure/cli': vendure,
        '@vendure/dashboard': vendure,
        ioredis: IOREDIS_VERSION,
        pg: PG_VERSION,
        'ts-node': TS_NODE_VERSION,
        typescript: TYPESCRIPT_VERSION,
        vite: VITE_VERSION,
        ...(input.scenario ? { [input.scenario.package]: input.scenario.version } : {}),
    };
    const pkg: Record<string, unknown> = {
        name: input.name,
        version: DEFAULT_PROJECT_VERSION,
        private: true,
        scripts: {
            dev: 'vendure dev',
            build: 'tsc',
            typecheck: 'tsc --noEmit',
        },
        vendure: { cli: { plugins: ['@vendure/cloud'] } },
        dependencies: sortKeys(dependencies),
        devDependencies: sortKeys(devDependencies),
    };
    return input.isRoot ? { ...pkg, ...getBuildScriptAllowlistFields(input.packageManager) } : pkg;
}

/** The root package.json of a project with a storefront: a workspace of the server and the storefront. */
export function getWorkspaceRootPackageJson(
    name: string,
    pmInfo: PackageManagerInfo,
): Record<string, unknown> {
    const ws = (workspace: string, script: string) => pmInfo.workspaceScript(workspace, script);
    const pkg: Record<string, unknown> = {
        name,
        version: DEFAULT_PROJECT_VERSION,
        private: true,
        scripts: {
            dev: `concurrently -n server,storefront -c blue,magenta "${ws('server', 'dev')}" "${ws('storefront', 'dev')}"`,
            'dev:server': ws('server', 'dev'),
            'dev:storefront': ws('storefront', 'dev'),
            build: `${ws('server', 'build')} && ${ws('storefront', 'build')}`,
            typecheck: ws('server', 'typecheck'),
        },
        devDependencies: { concurrently: CONCURRENTLY_VERSION },
    };
    if (pmInfo.usesPackageJsonWorkspaces) {
        pkg.workspaces = ['apps/*'];
    }
    return { ...pkg, ...getBuildScriptAllowlistFields(pmInfo.name) };
}

/** The root package.json fields that allowlist dependency build scripts. pnpm's live in pnpm-workspace.yaml. */
export function getBuildScriptAllowlistFields(
    packageManager: CreateRecordPackageManager,
): Record<string, unknown> {
    switch (packageManager) {
        case 'npm':
            return { allowScripts: Object.fromEntries(NATIVE_BUILD_DEPENDENCIES.map(dep => [dep, true])) };
        case 'yarn':
            return {
                dependenciesMeta: Object.fromEntries(
                    NATIVE_BUILD_DEPENDENCIES.map(dep => [dep, { built: true }]),
                ),
            };
        case 'bun':
            return { trustedDependencies: [...NATIVE_BUILD_DEPENDENCIES] };
        case 'pnpm':
            return {};
    }
}

/**
 * pnpm reads its settings, including the build-script allowlist, only from pnpm-workspace.yaml
 * since v11. v10 uses `onlyBuiltDependencies` and v11 `allowBuilds`, so both are written.
 */
export function getPnpmWorkspaceYaml(packagesGlobs?: string[]): string {
    const lines: string[] = [];
    if (packagesGlobs?.length) {
        lines.push('packages:', ...packagesGlobs.map(glob => `    - '${glob}'`), '');
    }
    lines.push('# pnpm v10 build-script allowlist', 'onlyBuiltDependencies:');
    lines.push(...NATIVE_BUILD_DEPENDENCIES.map(dep => `    - ${dep}`), '');
    lines.push('# pnpm v11 build-script allowlist', 'allowBuilds:');
    lines.push(...NATIVE_BUILD_DEPENDENCIES.map(dep => `    ${dep}: true`), '');
    lines.push(
        '# pnpm v11 fails the install when a dependency has build scripts not covered by',
        '# allowBuilds. With this off, uncovered scripts are skipped with a warning instead.',
        'strictDepBuilds: false',
        '',
    );
    return lines.join('\n');
}

/**
 * The project's code and the `vendure dev` runtime both resolve packages from a physical
 * node_modules tree, so yarn's Plug'n'Play is turned off.
 */
export function getYarnRcYml(): string {
    return 'nodeLinker: node-modules\n';
}

export interface ReadmeInput {
    name: string;
    pmInfo: PackageManagerInfo;
    storefront: StorefrontStarter | undefined;
}

export function renderReadme(template: string, input: ReadmeInput): string {
    return Handlebars.compile(template)({
        name: input.name,
        dev: `${input.pmInfo.runScript} dev`,
        build: `${input.pmInfo.runScript} build`,
        typecheck: `${input.pmInfo.runScript} typecheck`,
        storefront: input.storefront,
        serverDir: input.storefront ? SERVER_WORKSPACE_DIR : undefined,
        serverPort: SERVER_PORT,
        storefrontPort: STOREFRONT_PORT,
        selfHostingGuideUrl: SELF_HOSTING_GUIDE_URL,
    });
}

/** The record of what the project was created with, which `vendure dev` and `vendure seed` read. */
export function buildCreateRecord(
    options: CreateOptions,
    createdWith: string,
    written: { agents: CreateOptions['agents'] },
): CreateRecord {
    return {
        version: CREATE_RECORD_VERSION,
        createdWith,
        packageManager: options.packageManager,
        preset: options.preset,
        scenario: options.scenario,
        features: [...options.features],
        storefront: options.storefront,
        // Only the clients whose files were written, as the record's contract says.
        agents: [...written.agents],
    };
}

/** The commands to run once create is done. */
export function getNextCommands(options: CreateOptions, projectDirArg: string): string[] {
    const pmInfo = getPackageManagerInfo(options.packageManager);
    return [
        `cd ${quoteShellArgument(projectDirArg)}`,
        ...(options.install ? [] : [pmInfo.install]),
        `${pmInfo.runScript} dev`,
    ];
}

function quoteShellArgument(value: string): string {
    return /^[\w./~:@+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function sortKeys(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
