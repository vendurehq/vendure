import {
    CommandErrorDefinition,
    ConfigResolverContext,
    configResolverDeclaration,
    ErrorResult,
    fail,
} from '@vendure/common/lib/command';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { configResolverFailed } from './config-resolver.errors.js';
import {
    isVendureConfig,
    loadVendureConfigFile,
    prepareToRequireProjectFiles,
    requireProjectModule,
} from './load-vendure-config-file.js';
import { openProject } from './open-project.js';
import { findVendureProjectRoot } from './project-validation.js';
import {
    CliPluginLoadFailure,
    failureAffectsCommandManifest,
    resolveCommandManifests,
    ResolvedCommandManifest,
} from './resolve-cli-plugins.js';
import { VendureConfigRef } from './vendure-config-ref.js';

type Project = Awaited<ReturnType<typeof openProject>>['project'];

/** Thrown by {@link loadProjectConfig} when a config resolver fails. */
export class ConfigResolverFailedError extends Error {
    constructor(
        readonly details: { plugin: string; message: string },
        readonly cause?: unknown,
    ) {
        super(configResolverFailed.message(details));
    }
}

export interface LoadProjectConfigOptions {
    /** The working directory, which `projectDir` and `configFile` are found from. Defaults to `process.cwd()`. */
    cwd?: string;
    /** The project's root directory. Defaults to the Vendure project at `cwd`. */
    projectDir?: string;
    /** The config file the user named with `--config`, relative to `cwd`. */
    configFile?: string;
    /** Fires when the command that needs the config is cancelled. */
    signal?: AbortSignal;
    /**
     * Opens the project with ts-morph to find a config in the source, and names the tsconfig to
     * compile it with. Defaults to {@link openProject}, which prints nothing.
     */
    openProject?: () => Promise<{ project: Project; tsConfigPath?: string }>;
    /** The enabled packages' manifests, when the caller has resolved them already, such as a test. */
    plugins?: ResolvedCommandManifest[];
}

/** A config that a package's config resolver returned. */
export interface ResolvedProjectConfig {
    config: VendureConfig;
    /** The package whose config resolver returned the config. */
    resolvedBy: string;
    /** The project's root directory the resolver was given. */
    projectDir: string;
}

/** A config found in the project's source. */
export interface SourceProjectConfig {
    config: VendureConfig;
    /** The absolute path of the config file. */
    configPath: string;
    /** The config's declaration. */
    ref: VendureConfigRef;
}

/** A project's config, and where it came from. */
export type ProjectConfig = ResolvedProjectConfig | SourceProjectConfig;

/**
 * The enabled packages whose manifests say they have a config resolver, in allowlist order. It
 * reads manifests only, and runs no code of the packages.
 */
export function configResolverPackages(plugins: ResolvedCommandManifest[]): ResolvedCommandManifest[] {
    const withResolver = plugins.filter(plugin => plugin.manifest.hasConfigResolver === true);
    // The project's resolvers first, so a package the project enabled is asked before one the
    // user enabled for the whole machine. The order within each allowlist is kept.
    return [
        ...withResolver.filter(plugin => plugin.scope === 'project'),
        ...withResolver.filter(plugin => plugin.scope !== 'project'),
    ];
}

/**
 * The result a command returns for an error that stopped its config from loading: the
 * `config.resolver-failed` of a failed resolver, or else the command's own `unreadable` error. It
 * rethrows the error of a cancelled command, so the host reports the command as cancelled.
 */
export function configErrorResult(
    e: unknown,
    signal: AbortSignal,
    unreadable: CommandErrorDefinition<{ message: string }>,
): ErrorResult {
    if (signal.aborted) {
        throw e;
    }
    if (e instanceof ConfigResolverFailedError) {
        return fail(configResolverFailed, e.details);
    }
    return fail(unreadable, { message: e instanceof Error ? e.message : String(e) });
}

/** Where a project's config came from, for a message: the resolver's package, or the config file. */
export function describeConfigSource(loaded: ProjectConfig): string {
    return 'resolvedBy' in loaded
        ? `the config resolver of ${loaded.resolvedBy}`
        : loaded.ref.getPathRelativeToProjectRoot();
}

/** The message of an error that stopped a config from loading, with its code for a failed resolver. */
export function describeConfigError(e: unknown): string {
    const message = e instanceof Error ? e.message : String(e);
    return e instanceof ConfigResolverFailedError
        ? `Error (${configResolverFailed.code}): ${message}`
        : `Error: ${message}`;
}

/** The project's root directory for {@link LoadProjectConfigOptions}. */
function projectDirOf(options: Pick<LoadProjectConfigOptions, 'cwd' | 'projectDir'>): string {
    const cwd = options.cwd ?? process.cwd();
    return path.resolve(cwd, options.projectDir ?? findVendureProjectRoot(cwd) ?? cwd);
}

/**
 * The enabled packages' manifests, and the enabled packages whose manifest could not be read. It
 * reads manifests only. Given `plugins`, it returns them, with no failures.
 */
export function enabledManifests(
    options: Pick<LoadProjectConfigOptions, 'cwd' | 'projectDir' | 'plugins'> = {},
): {
    plugins: ResolvedCommandManifest[];
    unreadable: CliPluginLoadFailure[];
} {
    if (options.plugins) {
        return { plugins: options.plugins, unreadable: [] };
    }
    const { manifests, failures } = resolveCommandManifests({ cwd: projectDirOf(options) });
    return { plugins: manifests, unreadable: failures.filter(failureAffectsCommandManifest) };
}

/**
 * The error of a config that could not be found in the source, naming the enabled packages whose
 * manifest could not be read. Any of them may have a config resolver that would have provided the
 * config, and nothing else reports a package that has no commands.
 */
export function withUnreadableManifests(
    error: unknown,
    unreadable: CliPluginLoadFailure[],
    consequence = 'so any config resolver they have was not asked',
): Error {
    const e = error instanceof Error ? error : new Error(String(error));
    if (unreadable.length === 0) {
        return e;
    }
    const list = unreadable.map(f => `${f.packageName} (${f.reason})`).join('; ');
    return new Error(
        `${e.message.replace(/\.$/, '')}. The manifest of these enabled packages could not be read, ` +
            `${consequence}: ${list}`,
    );
}

/**
 * Loads the project's Vendure config. It asks the config resolvers of the enabled packages, in
 * allowlist order, and returns the first config one returns. When none does, it finds the
 * `VendureConfig` in the project's source with ts-morph and loads that. It prints nothing.
 *
 * It throws {@link ConfigResolverFailedError} when a resolver fails, and a plain error when no
 * config can be found or loaded.
 */
export async function loadProjectConfig(options: LoadProjectConfigOptions = {}): Promise<ProjectConfig> {
    return loadProjectConfigWith(options, () => loadSourceConfig(options));
}

/**
 * {@link loadProjectConfig}, with `loadFromSource` in place of finding the config in the source,
 * for a command that loads it some other way first. When `loadFromSource` throws, the error names
 * the enabled packages whose manifest could not be read.
 */
export async function loadProjectConfigWith<T>(
    options: LoadProjectConfigOptions,
    loadFromSource: () => Promise<T>,
): Promise<ResolvedProjectConfig | T> {
    const { plugins, unreadable } = enabledManifests(options);
    const resolved = await resolveProjectConfig({ ...options, plugins });
    if (resolved) {
        return resolved;
    }
    try {
        return await loadFromSource();
    } catch (e) {
        throw withUnreadableManifests(e, unreadable);
    }
}

/**
 * Asks the config resolvers of the enabled packages for the project's config, in allowlist order.
 * Returns `undefined` when none returns one. See {@link loadProjectConfig}.
 */
export async function resolveProjectConfig(
    options: LoadProjectConfigOptions = {},
): Promise<ResolvedProjectConfig | undefined> {
    const cwd = options.cwd ?? process.cwd();
    const projectDir = projectDirOf(options);
    // Absolute, so a resolver need not know the working directory to find the file.
    const configFile = options.configFile === undefined ? undefined : path.resolve(cwd, options.configFile);
    for (const plugin of configResolverPackages(enabledManifests(options).plugins)) {
        const config = await resolveWith(plugin, {
            projectDir,
            configFile,
            signal: options.signal ?? new AbortController().signal,
            // Lazy: ts-node and `.env` are set up only when a resolver calls it.
            loadModule: file => requireProjectModule(path.resolve(projectDir, file)),
        });
        if (config) {
            // `loadSourceConfig` loads `.env` and registers ts-node to require the config file. A
            // resolved config skipped that, and the files it names, such as migrations that TypeORM
            // requires, may be TypeScript or read `.env`.
            try {
                await prepareToRequireProjectFiles(projectDir);
            } catch (e) {
                throw new Error(
                    `The config resolver of ${plugin.packageName} returned a config, but the project could ` +
                        `not be prepared to load the TypeScript files it names: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
            return { config, resolvedBy: plugin.packageName, projectDir };
        }
    }
    return undefined;
}

/**
 * Finds the `VendureConfig` in the project's source with ts-morph, and loads it, without asking
 * the config resolvers. See {@link loadProjectConfig}.
 */
export async function loadSourceConfig(
    options: Pick<LoadProjectConfigOptions, 'configFile' | 'openProject'> = {},
): Promise<SourceProjectConfig> {
    const { project, tsConfigPath } = await (options.openProject ?? openProject)();
    const ref = new VendureConfigRef(project, options.configFile);
    const config = await loadVendureConfigFile(ref, tsConfigPath);
    return { config, configPath: ref.sourceFile.getFilePath(), ref };
}

async function resolveWith(
    plugin: ResolvedCommandManifest,
    ctx: ConfigResolverContext,
): Promise<VendureConfig | undefined> {
    const failed = (message: string, cause?: unknown) =>
        new ConfigResolverFailedError({ plugin: plugin.packageName, message }, cause);
    let config: unknown;
    try {
        const declaration = configResolverDeclaration(
            await import(pathToFileURL(plugin.definitionsPath).href),
        );
        if (!declaration) {
            throw new Error(
                `${plugin.definitionsPath} exports no "configResolver", which its manifest lists`,
            );
        }
        const resolver = await declaration.resolve();
        if (typeof resolver?.resolve !== 'function') {
            throw new TypeError('its module exports no resolve() function');
        }
        config = await resolver.resolve(ctx);
    } catch (e) {
        // A resolver that stops because the command was cancelled has not failed. The host
        // reports the error it throws as the command's cancellation.
        if (ctx.signal.aborted) {
            throw e;
        }
        throw failed(e instanceof Error ? e.message : String(e), e);
    }
    if (config === undefined) {
        return undefined;
    }
    if (!isVendureConfig(config)) {
        throw failed('it returned something that is not a VendureConfig');
    }
    return config;
}
