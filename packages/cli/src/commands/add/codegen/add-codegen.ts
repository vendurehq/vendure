import { cancel, log, note, spinner } from '@clack/prompts';

import { exitCliCommand } from '../../../shared/cli-command-exit.js';
import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command.js';
import { PackageJson } from '../../../shared/package-json-ref.js';
import { analyzeProject } from '../../../shared/shared-prompts.js';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref.js';
import { pauseForPromptDisplay } from '../../../utilities/utils.js';

import { CODEGEN_PACKAGES, configureCodegen } from './add-codegen.shared.js';

/**
 * Sets up codegen for a plugin that was just created, from the follow-up menu of
 * `vendure add` > plugin. On its own, codegen is `vendure add codegen`, which runs through the
 * command host.
 *
 * The two differ until the follow-up menu runs `vendure add codegen` too: this one installs with
 * `PackageJson.installPackages`, logs a failed install as an error and prints its own next steps.
 * `vendure add codegen` spawns each install command, reports a failed install as a warning, and
 * returns its next steps in its output.
 */
export const addCodegenCommand = new CliCommand<{ plugin: VendurePluginRef }>({
    id: 'add-codegen',
    category: 'Project: Codegen',
    description: 'Set up GraphQL code generation',
    run: addCodegen,
});

async function addCodegen(options?: Partial<{ plugin: VendurePluginRef }>): Promise<CliCommandReturnVal> {
    if (!options?.plugin) {
        throw new Error('Codegen needs the plugin to set up. Run "vendure add codegen" instead.');
    }
    const plugin = options.plugin;
    const { project } = await analyzeProject({
        providedVendurePlugin: plugin,
        cancelledMessage: 'Add codegen cancelled',
    });

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

    const codegenFile = configureCodegen(project, packageJson, [plugin.classDeclaration.getSourceFile()]);

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
