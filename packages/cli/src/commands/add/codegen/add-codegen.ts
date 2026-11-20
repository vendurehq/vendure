import { cancel, log, note, spinner } from '@clack/prompts';

import { exitCliCommand } from '../../../shared/cli-command-exit.js';
import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command.js';
import { PackageJson } from '../../../shared/package-json-ref.js';
import { resolvePluginFromOptions } from '../../../shared/plugin-resolution.js';
import { analyzeProject, selectMultiplePluginClasses } from '../../../shared/shared-prompts.js';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref.js';
import { pauseForPromptDisplay } from '../../../utilities/utils.js';

import { CODEGEN_PACKAGES, configureCodegen } from './add-codegen.shared.js';

export interface AddCodegenOptions {
    plugin?: VendurePluginRef;
    pluginName?: string;
    config?: string;
    isNonInteractive?: boolean;
}

export const addCodegenCommand = new CliCommand({
    id: 'add-codegen',
    category: 'Project: Codegen',
    description: 'Set up GraphQL code generation',
    run: addCodegen,
});

export async function addCodegen(options?: AddCodegenOptions): Promise<CliCommandReturnVal> {
    const providedVendurePlugin = options?.plugin;
    const { project } = await analyzeProject({
        providedVendurePlugin,
        cancelledMessage: 'Add codegen cancelled',
        config: options?.config,
    });

    const { plugin: resolvedPlugin } = resolvePluginFromOptions(project, {
        providedPlugin: providedVendurePlugin,
        pluginName: options?.pluginName,
        isNonInteractive: options?.isNonInteractive === true,
    });

    const plugins = resolvedPlugin
        ? [resolvedPlugin]
        : await selectMultiplePluginClasses(project, 'Add codegen cancelled');

    const packageJson = new PackageJson(project);
    const installSpinner = spinner();
    installSpinner.start(`Installing dependencies...`);
    const packageManager = packageJson.determinePackageManager();
    const packageJsonFile = packageJson.locatePackageJsonWithVendureDependency();
    log.info(`Detected package manager: ${packageManager}`);
    if (!packageJsonFile) {
        cancel(`Could not locate package.json file with a dependency on Vendure.`);
        exitCliCommand(1);
    }
    log.info(`Detected package.json: ${packageJsonFile}`);
    try {
        await packageJson.installPackages(CODEGEN_PACKAGES);
    } catch (e: any) {
        log.error(`Failed to install dependencies: ${e.message as string}.`);
    }
    installSpinner.stop('Dependencies installed');

    const configSpinner = spinner();
    configSpinner.start('Configuring codegen file...');
    await pauseForPromptDisplay();

    const codegenFile = configureCodegen(
        project,
        packageJson,
        plugins.map(pluginRef => pluginRef.classDeclaration.getSourceFile()),
    );

    configSpinner.stop('Configured codegen file');

    await project.save();

    const nextSteps = [
        `You can run codegen by doing the following:`,
        `1. Run "npx vendure schema" to generate a schema file`,
        `2. Run "npm run codegen"`,
    ];
    note(nextSteps.join('\n'));

    return {
        project,
        modifiedSourceFiles: [codegenFile.sourceFile],
    };
}
