import { log } from '@clack/prompts';
import fs from 'fs-extra';
import path from 'node:path';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { analyzeProject, selectPlugin } from '../../../shared/shared-prompts';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref';
import { createFile, getPluginClasses } from '../../../utilities/ast-utils';

export interface AddDashboardOptions {
    plugin?: VendurePluginRef;
    pluginName?: string;
    config?: string;
    isNonInteractive?: boolean;
}

export const addDashboardCommand = new CliCommand({
    id: 'add-dashboard',
    category: 'Plugin: Dashboard',
    description: 'Add Dashboard extensions',
    run: addDashboard,
});

export async function addDashboard(options?: AddDashboardOptions): Promise<CliCommandReturnVal> {
    const providedVendurePlugin = options?.plugin;
    const { project } = await analyzeProject({ providedVendurePlugin, config: options?.config });

    // Detect non-interactive mode
    const isNonInteractive = options?.isNonInteractive === true;

    let vendurePlugin: VendurePluginRef | undefined = providedVendurePlugin;

    // If a plugin name was provided, try to find it
    if (!vendurePlugin && options?.pluginName) {
        const pluginClasses = getPluginClasses(project);
        const foundPlugin = pluginClasses.find(p => p.getName() === options.pluginName);

        if (!foundPlugin) {
            // List available plugins if the specified one wasn't found
            const availablePlugins = pluginClasses.map(p => p.getName()).filter(Boolean);
            throw new Error(
                `Plugin "${options.pluginName}" not found. Available plugins:\n` +
                    availablePlugins.map(name => `  - ${name as string}`).join('\n'),
            );
        }

        vendurePlugin = new VendurePluginRef(foundPlugin);
    }

    // In non-interactive mode, we need a plugin specified
    if (isNonInteractive && !vendurePlugin) {
        throw new Error('Plugin must be specified when running in non-interactive mode');
    }
    vendurePlugin = vendurePlugin ?? (await selectPlugin(project, 'Add UI extensions cancelled'));

    try {
        vendurePlugin.addMetadataProperty('dashboard', './dashboard/index.tsx');
        log.success('Updated the plugin class');
    } catch (e) {
        log.error(e instanceof Error ? e.message : String(e));
        return { project, modifiedSourceFiles: [] };
    }

    const pluginDir = vendurePlugin.getPluginDir().getPath();
    const dashboardEntrypointFile = path.join(pluginDir, 'dashboard', 'index.tsx');
    if (!fs.existsSync(dashboardEntrypointFile)) {
        createFile(project, path.join(__dirname, 'templates/index.template.tsx'), dashboardEntrypointFile);
    }
    log.success('Created Dashboard extension scaffold');

    await project.save();
    return { project, modifiedSourceFiles: [vendurePlugin.classDeclaration.getSourceFile()] };
}
