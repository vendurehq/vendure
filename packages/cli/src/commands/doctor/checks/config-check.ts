import {
    getCompatibility,
    preBootstrapConfig,
    resetConfig,
    RuntimeVendureConfig,
    VENDURE_VERSION,
} from '@vendure/core';
import { satisfies } from 'semver';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';
import { CheckResult } from '../types';

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
export async function runConfigCheck(configFlag?: string): Promise<ConfigCheckResult> {
    const details: string[] = [];
    let runtimeConfig: RuntimeVendureConfig | undefined;

    try {
        resetConfig();
        process.env.VENDURE_RUNNING_IN_CLI = 'true';

        // 1. Analyze the project (finds tsconfig, creates ts-morph Project)
        const { project, vendureTsConfig } = await analyzeProject({
            cancelledMessage: '',
            config: configFlag,
        });

        // 2. Find the VendureConfig source file
        const vendureConfigRef = new VendureConfigRef(project, configFlag);
        const configPath = vendureConfigRef.getPathRelativeToProjectRoot();
        details.push(`Config loaded from ${configPath}`);

        // 3. Load the config at runtime (ts-node, path mappings, dotenv)
        const config = await loadVendureConfigFile(vendureConfigRef, vendureTsConfig);

        // 4. Run preBootstrapConfig() -- validates custom fields, registers entities,
        //    runs plugin configuration() hooks, sets strategies
        runtimeConfig = await preBootstrapConfig(config);
        details.push('Custom fields validated');
        details.push('Plugin configuration completed');

        // 5. Check plugin compatibility
        const pluginResults = checkPlugins(runtimeConfig);
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
            vendureVersion: VENDURE_VERSION,
        };
    } catch (e: any) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        details.push(`Error: ${errorMessage}`);
        return {
            check: {
                name: 'Config',
                status: 'fail',
                message: 'Failed to load Vendure config',
                details,
            },
            config: runtimeConfig,
            vendureVersion: VENDURE_VERSION,
        };
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
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
function checkPlugins(config: RuntimeVendureConfig): PluginCheckResult {
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
        const compatibility = getCompatibility(plugin);

        if (!compatibility) {
            hasNoCompat = true;
            noCompatCount++;
            details.push(`Plugin "${pluginName}": no compatibility range specified`);
        } else if (
            !satisfies(VENDURE_VERSION, compatibility, { loose: true, includePrerelease: true })
        ) {
            hasIncompatible = true;
            details.push(
                `Plugin "${pluginName}": incompatible (requires ${compatibility}, running ${VENDURE_VERSION})`,
            );
        }
    }

    return { details, hasIncompatible, hasNoCompat, noCompatCount };
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
