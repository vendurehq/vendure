import { Project } from 'ts-morph';

import { getPluginClasses } from '../utilities/ast-utils';

import { VendurePluginRef } from './vendure-plugin-ref';

export interface PluginResolutionOptions {
    providedPlugin?: VendurePluginRef;
    pluginName?: string;
    isNonInteractive?: boolean;
}

export interface PluginResolutionResult {
    plugin: VendurePluginRef | undefined;
    shouldPromptForSelection: boolean;
}

/**
 * Resolves a plugin reference from provided options, handling both interactive and non-interactive modes.
 * This function centralizes the common plugin resolution logic used across multiple CLI commands.
 */
export function resolvePluginFromOptions(
    project: Project,
    options: PluginResolutionOptions,
): PluginResolutionResult {
    let plugin: VendurePluginRef | undefined = options.providedPlugin;

    if (!plugin && options.pluginName) {
        const pluginClasses = getPluginClasses(project);
        const foundPlugin = pluginClasses.find(p => p.getName() === options.pluginName);

        if (!foundPlugin) {
            const availablePlugins = pluginClasses.map(p => p.getName()).filter(Boolean);
            throw new Error(
                `Plugin "${options.pluginName}" not found. Available plugins:\n` +
                    availablePlugins.map(name => `  - ${name as string}`).join('\n'),
            );
        }

        plugin = new VendurePluginRef(foundPlugin);
    }

    if (options.isNonInteractive && !plugin) {
        throw new Error('Plugin must be specified when running in non-interactive mode');
    }

    return {
        plugin,
        shouldPromptForSelection: !plugin && !options.isNonInteractive,
    };
}
