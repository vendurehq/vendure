import { ConfigResolverContext, configResolverDeclaration } from '@vendure/common/lib/command';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { configResolverFailed } from './config-resolver.errors.js';
import { isVendureConfig, loadVendureConfigFile, loadVendureConfigFromPath } from './load-vendure-config-file.js';
import { openProject } from './open-project.js';
import { findVendureProjectRoot } from './project-validation.js';
import {
    failureAffectsCommandManifest,
    ResolvedCommandManifest,
    resolveCommandManifests,
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
export function configResolverPackages(
    options: Pick<LoadProjectConfigOptions, 'projectDir' | 'plugins'> = {},
): ResolvedCommandManifest[] {
    const plugins =
        options.plugins ?? resolveCommandManifests({ cwd: options.projectDir ?? process.cwd() }).manifests;
    return plugins.filter(plugin => plugin.manifest.hasConfigResolver === true);
}

/**
 * The error of a config that could not be found in the source, naming the enabled packages whose
 * manifest could not be read. Any of them may have a config resolver that would have provided the
 * config, and nothing else reports a package that has no commands.
 */
export function withUnreadableManifests(
    error: unknown,
    options: Pick<LoadProjectConfigOptions, 'cwd' | 'projectDir' | 'plugins'> = {},
): Error {
    const e = error instanceof Error ? error : new Error(String(error));
    if (options.plugins) {
        return e;
    }
    const cwd = options.cwd ?? process.cwd();
    const projectDir = path.resolve(cwd, options.projectDir ?? findVendureProjectRoot(cwd) ?? cwd);
    const unreadable = resolveCommandManifests({ cwd: projectDir }).failures.filter(
        failureAffectsCommandManifest,
    );
    if (unreadable.length === 0) {
        return e;
    }
    const list = unreadable.map(f => `${f.packageName} (${f.reason})`).join('; ');
    return new Error(
        `${e.message.replace(/\.$/, '')}. The manifest of these enabled packages could not be read, ` +
            `so any config resolver they have was not asked: ${list}`,
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
    const resolved = await resolveProjectConfig(options);
    if (resolved) {
        return resolved;
    }
    try {
        return await loadSourceConfig(options);
    } catch (e) {
        throw withUnreadableManifests(e, options);
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
    const projectDir = path.resolve(cwd, options.projectDir ?? findVendureProjectRoot(cwd) ?? cwd);
    // Absolute, so a resolver need not know the working directory to find the file.
    const configFile = options.configFile === undefined ? undefined : path.resolve(cwd, options.configFile);
    for (const plugin of configResolverPackages({ projectDir, plugins: options.plugins })) {
        const config = await resolveWith(plugin, {
            projectDir,
            configFile,
            signal: options.signal ?? new AbortController().signal,
            loadConfigFile: file => loadConfigFileForResolver(path.resolve(projectDir, file)),
        });
        if (config) {
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

/**
 * The `loadConfigFile` of a resolver's context. ts-node is registered only when it is called, not
 * before the resolvers run.
 */
async function loadConfigFileForResolver(configFile: string): Promise<VendureConfig> {
    const config = await loadVendureConfigFromPath(configFile);
    if (!config) {
        throw new Error(
            `${configFile} exports no "config", and not exactly one other VendureConfig`,
        );
    }
    return config;
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
