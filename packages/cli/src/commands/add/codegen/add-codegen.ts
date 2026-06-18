import { cancel, log, note, spinner } from '@clack/prompts';
import path from 'path';
import { StructureKind } from 'ts-morph';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { PackageJson } from '../../../shared/package-json-ref';
import { resolvePluginFromOptions } from '../../../shared/plugin-resolution';
import { analyzeProject, selectMultiplePluginClasses } from '../../../shared/shared-prompts';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref';
import { getRelativeImportPath } from '../../../utilities/ast-utils';
import { pauseForPromptDisplay } from '../../../utilities/utils';

import { CodegenConfigRef } from './codegen-config-ref';

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
    const packagesToInstall = [
        {
            pkg: '@graphql-codegen/cli',
            isDevDependency: true,
        },
        {
            pkg: '@graphql-codegen/typescript',
            isDevDependency: true,
        },
    ];
    if (plugins.some(p => p.hasUiExtensions())) {
        packagesToInstall.push({
            pkg: '@graphql-codegen/client-preset',
            isDevDependency: true,
        });
    }
    const packageManager = packageJson.determinePackageManager();
    const packageJsonFile = packageJson.locatePackageJsonWithVendureDependency();
    log.info(`Detected package manager: ${packageManager}`);
    if (!packageJsonFile) {
        cancel(`Could not locate package.json file with a dependency on Vendure.`);
        process.exit(1);
    }
    log.info(`Detected package.json: ${packageJsonFile}`);
    try {
        await packageJson.installPackages(packagesToInstall);
    } catch (e: any) {
        log.error(`Failed to install dependencies: ${e.message as string}.`);
    }
    installSpinner.stop('Dependencies installed');

    const configSpinner = spinner();
    configSpinner.start('Configuring codegen file...');
    await pauseForPromptDisplay();

    const codegenFile = new CodegenConfigRef(project, packageJson.getPackageRootDir());

    const rootDir = project.getDirectory('.');
    if (!rootDir) {
        throw new Error('Could not find the root directory of the project');
    }
    for (const pluginRef of plugins) {
        const relativePluginPath = getRelativeImportPath({
            from: rootDir,
            to: pluginRef.classDeclaration.getSourceFile(),
        });
        const generatedTypesPath = `${path.dirname(relativePluginPath)}/gql/generated.ts`;
        codegenFile.addEntryToGeneratesObject({
            name: `'${generatedTypesPath}'`,
            kind: StructureKind.PropertyAssignment,
            initializer: `{ plugins: ['typescript'] }`,
        });

        if (pluginRef.hasUiExtensions()) {
            const uiExtensionsPath = `${path.dirname(relativePluginPath)}/ui`;
            codegenFile.addEntryToGeneratesObject({
                name: `'${uiExtensionsPath}/gql/'`,
                kind: StructureKind.PropertyAssignment,
                initializer: `{
                        preset: 'client',
                        documents: '${uiExtensionsPath}/**/*.ts',
                        presetConfig: {
                            fragmentMasking: false,
                        },
                     }`,
            });
        }
    }

    packageJson.addScriptToRootPackageJson('codegen', 'graphql-codegen --config codegen.ts');

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
