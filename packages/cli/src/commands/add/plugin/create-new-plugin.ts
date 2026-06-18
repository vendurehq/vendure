import { cancel, intro, isCancel, log, select, spinner, text } from '@clack/prompts';
import { constantCase, paramCase, pascalCase } from 'change-case';
import * as fs from 'fs-extra';
import path from 'path';
import { Project, SourceFile } from 'ts-morph';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { analyzeProject } from '../../../shared/shared-prompts';
import { VendureConfigRef } from '../../../shared/vendure-config-ref';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref';
import { addImportsToFile, createFile, getPluginClasses } from '../../../utilities/ast-utils';
import { pauseForPromptDisplay, withInteractiveTimeout } from '../../../utilities/utils';
import { addApiExtensionCommand } from '../api-extension/add-api-extension';
import { addCodegenCommand } from '../codegen/add-codegen';
import { addDashboardCommand } from '../dashboard/add-dashboard';
import { addEntityCommand } from '../entity/add-entity';
import { addJobQueueCommand } from '../job-queue/add-job-queue';
import { addServiceCommand } from '../service/add-service';

import { GeneratePluginOptions, NewPluginTemplateContext } from './types';

export const createNewPluginCommand = new CliCommand({
    id: 'create-new-plugin',
    category: 'Plugin',
    description: 'Create a new Vendure plugin',
    run: (options?: Partial<GeneratePluginOptions>) => createNewPlugin(options),
});

const cancelledMessage = 'Plugin setup cancelled.';

export async function createNewPlugin(
    options: Partial<GeneratePluginOptions> = {},
): Promise<CliCommandReturnVal> {
    // Validate that if a name is provided, it's actually a string
    if (options.name !== undefined && (typeof options.name !== 'string' || !options.name.trim())) {
        throw new Error('Plugin name is required. Usage: vendure add -p <plugin-name>');
    }

    const isNonInteractive = !!options.name;
    if (!isNonInteractive) {
        intro('Adding a new Vendure plugin!');
    }
    const { project, config, vendureTsConfig } = await analyzeProject({
        cancelledMessage,
        config: options.config,
    });
    if (!options.name) {
        const name = await text({
            message: 'What is the name of the plugin?',
            initialValue: 'my-new-feature',
            validate: input => {
                if (!/^[a-z][a-z-0-9]+$/.test(input)) {
                    return 'The plugin name must be lowercase and contain only letters, numbers and dashes';
                }
            },
        });

        if (isCancel(name)) {
            cancel(cancelledMessage);
            process.exit(0);
        } else {
            options.name = name;
        }
    }
    const existingPluginDir = findExistingPluginsDir(project);
    const vendureProjectDir = vendureTsConfig ? path.dirname(vendureTsConfig) : process.cwd();
    const pluginDir = getPluginDirName(options.name, existingPluginDir, vendureProjectDir);

    if (isNonInteractive) {
        options.pluginDir = pluginDir;
        if (fs.existsSync(options.pluginDir)) {
            throw new Error(`A directory named "${options.pluginDir}" already exists.`);
        }
    } else {
        const confirmation = await text({
            message: 'Plugin location',
            initialValue: pluginDir,
            placeholder: '',
            validate: input => {
                if (fs.existsSync(input)) {
                    return `A directory named "${input}" already exists. Please specify a different directory.`;
                }
            },
        });

        if (isCancel(confirmation)) {
            cancel(cancelledMessage);
            process.exit(0);
        }
        options.pluginDir = confirmation;
    }

    const { plugin, modifiedSourceFiles } = await generatePlugin(project, options as GeneratePluginOptions);

    const configSpinner = spinner();
    configSpinner.start('Updating VendureConfig...');
    await pauseForPromptDisplay();
    const vendureConfig = new VendureConfigRef(project, config);
    vendureConfig.addToPluginsArray(`${plugin.name}.init({})`);
    addImportsToFile(vendureConfig.sourceFile, {
        moduleSpecifier: plugin.getSourceFile(),
        namedImports: [plugin.name],
    });
    await vendureConfig.sourceFile.getProject().save();
    configSpinner.stop('Updated VendureConfig');

    if (isNonInteractive) {
        return {
            project,
            modifiedSourceFiles: [],
        };
    }
    let done = false;
    const followUpCommands = [
        addEntityCommand,
        addServiceCommand,
        addApiExtensionCommand,
        addJobQueueCommand,
        addDashboardCommand,
        addCodegenCommand,
    ];
    let allModifiedSourceFiles = [...modifiedSourceFiles];
    while (!done) {
        const featureType = await withInteractiveTimeout(async () => {
            return await select({
                message: `Add features to ${options.name ?? 'plugin'}?`,
                options: [
                    { value: 'no', label: "[Finish] No, I'm done!" },
                    ...followUpCommands.map(c => ({
                        value: c.id,
                        label: `[${c.category}] ${c.description}`,
                    })),
                ],
            });
        });

        if (isCancel(featureType) || featureType === 'no') {
            done = true;
        } else {
            const command = followUpCommands.find(c => c.id === featureType);
            if (!command) {
                break;
            }
            try {
                const result = await command.run({ plugin });
                allModifiedSourceFiles = result.modifiedSourceFiles;
                // We format all modified source files and re-load the
                // project to avoid issues with the project state
                for (const sourceFile of allModifiedSourceFiles) {
                    sourceFile.organizeImports();
                }
            } catch (e: any) {
                log.error(`Error adding feature "${command.id}"`);
                log.error(e.stack);
            }
        }
    }

    return {
        project,
        modifiedSourceFiles: [],
    };
}

export async function generatePlugin(
    project: Project,
    options: GeneratePluginOptions,
): Promise<{ plugin: VendurePluginRef; modifiedSourceFiles: SourceFile[] }> {
    const nameWithoutPlugin = options.name.replace(/-?plugin$/i, '');
    const normalizedName = nameWithoutPlugin + '-plugin';
    const templateContext: NewPluginTemplateContext = {
        ...options,
        pluginName: pascalCase(normalizedName),
        pluginInitOptionsName: constantCase(normalizedName) + '_OPTIONS',
    };

    const projectSpinner = spinner();
    projectSpinner.start('Generating plugin scaffold...');
    await pauseForPromptDisplay();

    const pluginFile = createFile(
        project,
        path.join(__dirname, 'templates/plugin.template.ts'),
        path.join(options.pluginDir, paramCase(nameWithoutPlugin) + '.plugin.ts'),
    );
    const pluginClass = pluginFile.getClass('TemplatePlugin');
    if (!pluginClass) {
        throw new Error('Could not find the plugin class in the generated file');
    }
    pluginFile.getImportDeclaration('./constants.template')?.setModuleSpecifier('./constants');
    pluginFile.getImportDeclaration('./types.template')?.setModuleSpecifier('./types');
    pluginClass.rename(templateContext.pluginName);

    const typesFile = createFile(
        project,
        path.join(__dirname, 'templates/types.template.ts'),
        path.join(options.pluginDir, 'types.ts'),
    );

    const constantsFile = createFile(
        project,
        path.join(__dirname, 'templates/constants.template.ts'),
        path.join(options.pluginDir, 'constants.ts'),
    );
    constantsFile
        .getVariableDeclaration('TEMPLATE_PLUGIN_OPTIONS')
        ?.rename(templateContext.pluginInitOptionsName)
        .set({ initializer: `Symbol('${templateContext.pluginInitOptionsName}')` });
    constantsFile
        .getVariableDeclaration('loggerCtx')
        ?.set({ initializer: `'${templateContext.pluginName}'` });

    projectSpinner.stop('Generated plugin scaffold');
    await project.save();
    return {
        modifiedSourceFiles: [pluginFile, typesFile, constantsFile],
        plugin: new VendurePluginRef(pluginClass),
    };
}

function findExistingPluginsDir(project: Project): { prefix: string; suffix: string } | undefined {
    const pluginClasses = getPluginClasses(project);
    if (pluginClasses.length === 0) {
        return;
    }
    if (pluginClasses.length === 1) {
        return { prefix: path.dirname(pluginClasses[0].getSourceFile().getDirectoryPath()), suffix: '' };
    }
    const pluginDirs = pluginClasses.map(c => {
        return c.getSourceFile().getDirectoryPath();
    });
    const prefix = findCommonPath(pluginDirs);
    const suffixStartIndex = prefix.length;
    const rest = pluginDirs[0].substring(suffixStartIndex).replace(/^\//, '').split('/');
    const suffix = rest.length > 1 ? rest.slice(1).join('/') : '';
    return { prefix, suffix };
}

function getPluginDirName(
    name: string,
    existingPluginDirPattern: { prefix: string; suffix: string } | undefined,
    vendureProjectDir: string,
) {
    const nameWithoutPlugin = name.replace(/-?plugin$/i, '');
    if (existingPluginDirPattern) {
        return path.join(
            existingPluginDirPattern.prefix,
            paramCase(nameWithoutPlugin),
            existingPluginDirPattern.suffix,
        );
    } else {
        // Use the Vendure project directory (which may be in a monorepo package)
        // instead of cwd (which could be the monorepo root)
        return path.join(vendureProjectDir, 'src', 'plugins', paramCase(nameWithoutPlugin));
    }
}

function findCommonPath(paths: string[]): string {
    if (paths.length === 0) {
        return ''; // If no paths provided, return empty string
    }

    // Split each path into segments
    const pathSegmentsList = paths.map(p => p.split('/'));

    // Find the minimum length of path segments (to avoid out of bounds)
    const minLength = Math.min(...pathSegmentsList.map(segments => segments.length));

    // Initialize the common path
    const commonPath: string[] = [];

    // Loop through each segment index up to the minimum length
    for (let i = 0; i < minLength; i++) {
        // Get the segment at the current index from the first path
        const currentSegment = pathSegmentsList[0][i];
        // Check if this segment is common across all paths
        const isCommon = pathSegmentsList.every(segments => segments[i] === currentSegment);
        if (isCommon) {
            // If it's common, add this segment to the common path
            commonPath.push(currentSegment);
        } else {
            // If it's not common, break out of the loop
            break;
        }
    }

    // Join the common path segments back into a string
    return commonPath.join('/');
}
