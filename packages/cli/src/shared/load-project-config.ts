import { configResolverDeclaration } from '@vendure/common/lib/command';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { configResolverFailed } from './config-resolver.errors.js';
import { loadVendureConfigFile } from './load-vendure-config-file.js';
import { openProject } from './open-project.js';
import { findVendureProjectRoot } from './project-validation.js';
import { ResolvedCommandManifest, resolveCommandManifests } from './resolve-cli-plugins.js';
import { VendureConfigRef } from './vendure-config-ref.js';

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
    /** The project's root directory. Defaults to the Vendure project at the working directory. */
    projectDir?: string;
    /** The config file the user named with `--config`. */
    configFile?: string;
    /** The tsconfig to compile a config found in the source with, when the nearest one is not it. */
    tsConfig?: string;
    signal?: AbortSignal;
    /** The enabled packages' manifests, when the caller has resolved them already, such as a test. */
    plugins?: ResolvedCommandManifest[];
}

/** A project's config, and where it came from. */
export interface ProjectConfig {
    config: VendureConfig;
    /** The package whose config resolver returned the config. Unset for a config found in the source. */
    resolvedBy?: string;
    /** The absolute path of the config file, for a config found in the source. */
    configPath?: string;
    /** The config's declaration, for a config found in the source. */
    ref?: VendureConfigRef;
}

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
 * Loads the project's Vendure config. It asks the config resolvers of the enabled packages, in
 * allowlist order, and returns the first config one returns. When none does, it finds the
 * `VendureConfig` in the project's source with ts-morph and loads that. It prints nothing.
 *
 * It throws {@link ConfigResolverFailedError} when a resolver fails, and a plain error when no
 * config can be found or loaded.
 */
export async function loadProjectConfig(options: LoadProjectConfigOptions = {}): Promise<ProjectConfig> {
    return (await resolveProjectConfig(options)) ?? (await loadSourceConfig(options));
}

/**
 * Asks the config resolvers of the enabled packages for the project's config, in allowlist order.
 * Returns `undefined` when none returns one. See {@link loadProjectConfig}.
 */
export async function resolveProjectConfig(
    options: LoadProjectConfigOptions = {},
): Promise<ProjectConfig | undefined> {
    const projectDir = path.resolve(
        options.projectDir ?? findVendureProjectRoot(process.cwd()) ?? process.cwd(),
    );
    for (const plugin of configResolverPackages({ projectDir, plugins: options.plugins })) {
        const config = await resolveWith(plugin, {
            projectDir,
            configFile: options.configFile,
            signal: options.signal ?? new AbortController().signal,
        });
        if (config) {
            return { config, resolvedBy: plugin.packageName };
        }
    }
    return undefined;
}

/**
 * Finds the `VendureConfig` in the project's source with ts-morph, and loads it, without asking
 * the config resolvers. See {@link loadProjectConfig}.
 */
export async function loadSourceConfig(
    options: Pick<LoadProjectConfigOptions, 'configFile' | 'tsConfig'> = {},
): Promise<ProjectConfig> {
    const { project, tsConfigPath } = await openProject();
    const ref = new VendureConfigRef(project, options.configFile);
    const config = await loadVendureConfigFile(ref, options.tsConfig ?? tsConfigPath);
    return { config, configPath: ref.sourceFile.getFilePath(), ref };
}

async function resolveWith(
    plugin: ResolvedCommandManifest,
    ctx: { projectDir: string; configFile?: string; signal: AbortSignal },
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
        throw failed(e instanceof Error ? e.message : String(e), e);
    }
    if (config === undefined) {
        return undefined;
    }
    if (typeof config !== 'object' || config === null || !('dbConnectionOptions' in config)) {
        throw failed('it returned something that is not a VendureConfig');
    }
    return config as VendureConfig;
}
