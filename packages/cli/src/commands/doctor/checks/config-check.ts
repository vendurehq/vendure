import type { RuntimeVendureConfig, VendureConfig } from '@vendure/core';
import { satisfies } from 'semver';

import { configResolverFailed } from '../../../shared/config-resolver.errors.js';
import { ConfigResolverFailedError, loadProjectConfig } from '../../../shared/load-project-config.js';
import { requireProjectCore } from '../../../shared/project-core.js';
import { analyzeProject } from '../../../shared/shared-prompts.js';
import { CheckResult } from '../types.js';

export interface ConfigCheckResult {
    check: CheckResult;
    /** The loaded runtime config, available for subsequent checks (schema, db, production). */
    config?: RuntimeVendureConfig;
    /** The Vendure version detected from @vendure/core. */
    vendureVersion?: string;
}

/**
 * Loads the Vendure config, runs preBootstrapConfig() to validate custom fields,
 * register entities, and run plugin configuration hooks. Then checks plugin
 * compatibility with the current Vendure version.
 */
export async function runConfigCheck(configFlag?: string, signal?: AbortSignal): Promise<ConfigCheckResult> {
    const details: string[] = [];
    let runtimeConfig: RuntimeVendureConfig | undefined;
    // Left undefined until the project's core has loaded, so a project that
    // cannot supply one is reported as a failed check rather than crashing the
    // whole doctor run.
    let vendureVersion: string | undefined;

    try {
        // The project's own Vendure, not the CLI's: a check of this project has
        // to run the code this project would run.
        const core = requireProjectCore();
        vendureVersion = core.VENDURE_VERSION;

        core.resetConfig();
        process.env.VENDURE_RUNNING_IN_CLI = 'true';

        const config = await loadDoctorConfig(configFlag, details, signal);

        // Run preBootstrapConfig() -- validates custom fields, registers entities,
        //    runs plugin configuration() hooks, sets strategies
        runtimeConfig = await core.preBootstrapConfig(config);
        details.push('Custom fields validated');
        details.push('Plugin configuration completed');

        // Check plugin compatibility
        const pluginResults = checkPlugins(runtimeConfig, core);
        details.push(...pluginResults.details);

        const status = pluginResults.hasIncompatible ? 'fail' : pluginResults.hasNoCompat ? 'warn' : 'pass';
        let message: string;
        if (status === 'pass') {
            message = 'Vendure config loaded and validated successfully';
        } else if (status === 'fail') {
            message = 'Plugin compatibility issues detected';
        } else {
            // warn -- explain why
            const parts: string[] = [];
            if (pluginResults.noCompatCount > 0) {
                parts.push(`${pluginResults.noCompatCount} plugin(s) without compatibility range`);
            }
            message = `Config loaded (${parts.join(', ')})`;
        }

        return {
            check: { name: 'Config', status, message, details },
            config: runtimeConfig,
            vendureVersion,
        };
    } catch (e: any) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        details.push(
            e instanceof ConfigResolverFailedError
                ? `Error (${configResolverFailed.code}): ${errorMessage}`
                : `Error: ${errorMessage}`,
        );
        return {
            check: {
                name: 'Config',
                status: 'fail',
                message: 'Failed to load Vendure config',
                details,
            },
            config: runtimeConfig,
            vendureVersion,
        };
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
}

/**
 * The project's config, from the config resolver of an enabled package, or else from the
 * `VendureConfig` in its source. Says in `details` where it came from.
 */
async function loadDoctorConfig(
    configFlag: string | undefined,
    details: string[],
    signal?: AbortSignal,
): Promise<VendureConfig> {
    const loaded = await loadProjectConfig({
        configFile: configFlag,
        signal,
        openProject: async () => {
            const { project, vendureTsConfig } = await analyzeProject({
                cancelledMessage: '',
                config: configFlag,
            });
            return { project, tsConfigPath: vendureTsConfig };
        },
    });
    details.push(
        'resolvedBy' in loaded
            ? `Config resolved by ${loaded.resolvedBy}`
            : `Config loaded from ${loaded.ref.getPathRelativeToProjectRoot()}`,
    );
    return loaded.config;
}

interface PluginCheckResult {
    details: string[];
    hasIncompatible: boolean;
    hasNoCompat: boolean;
    noCompatCount: number;
}

/**
 * Checks each plugin's compatibility range against the current Vendure version.
 * Reports results per-plugin instead of throwing on the first incompatible one.
 */
function checkPlugins(config: RuntimeVendureConfig, core: typeof import('@vendure/core')): PluginCheckResult {
    const details: string[] = [];
    let hasIncompatible = false;
    let hasNoCompat = false;
    let noCompatCount = 0;

    if (!config.plugins || config.plugins.length === 0) {
        details.push('No plugins configured');
        return { details, hasIncompatible, hasNoCompat, noCompatCount };
    }

    details.push(`${config.plugins.length} plugin(s) loaded`);

    for (const plugin of config.plugins) {
        // DynamicModule plugins (e.g. SomePlugin.init()) have the class on .module
        const pluginName = getPluginName(plugin);
        const compatibility = core.getCompatibility(plugin);

        if (!compatibility) {
            hasNoCompat = true;
            noCompatCount++;
            details.push(`Plugin "${pluginName}": no compatibility range specified`);
        } else if (!isCompatibleWithCore(core, compatibility)) {
            hasIncompatible = true;
            details.push(
                `Plugin "${pluginName}": incompatible (requires ${compatibility}, running ${core.VENDURE_VERSION})`,
            );
        }
    }

    return { details, hasIncompatible, hasNoCompat, noCompatCount };
}

/**
 * Runs the project's own compatibility check, so the doctor agrees with what the server does at
 * startup. A core older than `isCompatible` checks the range with plain `satisfies`.
 */
export function isCompatibleWithCore(core: typeof import('@vendure/core'), compatibility: string): boolean {
    const { isCompatible } = core as { isCompatible?: (version: string, range: string) => boolean };
    return typeof isCompatible === 'function'
        ? isCompatible(core.VENDURE_VERSION, compatibility)
        : satisfies(core.VENDURE_VERSION, compatibility, { loose: true, includePrerelease: true });
}

/**
 * Extracts the plugin name, handling both plain classes and DynamicModule objects.
 */
function getPluginName(plugin: any): string {
    // DynamicModule has { module: Type<any>, ... }
    if (plugin && plugin.module && plugin.module.name) {
        return plugin.module.name;
    }
    // Plain class
    if (plugin && plugin.name) {
        return plugin.name;
    }
    return 'Unknown';
}
