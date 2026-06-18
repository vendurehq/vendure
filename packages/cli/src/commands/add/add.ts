import { cancel, intro, isCancel, log, outro, select, spinner } from '@clack/prompts';
import pc from 'picocolors';

import { Messages } from '../../constants';
import { pauseForPromptDisplay, withInteractiveTimeout } from '../../utilities/utils';
import { cliCommands } from '../command-declarations';

import { addApiExtension } from './api-extension/add-api-extension';
import { addCodegen } from './codegen/add-codegen';
import { addDashboard } from './dashboard/add-dashboard';
import { addEntity } from './entity/add-entity';
import { addJobQueue } from './job-queue/add-job-queue';
import { createNewPlugin } from './plugin/create-new-plugin';
import { addService } from './service/add-service';
import { addUiExtensions } from './ui-extensions/add-ui-extensions';

const cancelledMessage = 'Add feature cancelled.';

export interface AddOptions {
    /** Create a new plugin with the given name */
    plugin?: string;
    /** Add a new entity class with the given name */
    entity?: string;
    /** Add a new service with the given name */
    service?: string;
    /** Add a job-queue handler to the specified plugin */
    jobQueue?: string | boolean;
    /** Add GraphQL codegen configuration to the specified plugin */
    codegen?: string | boolean;
    /** Add an API extension scaffold to the specified plugin */
    apiExtension?: string | boolean;
    /** Add Admin-UI extensions to the specified plugin */
    uiExtensions?: string | boolean;
    /** Add Dashboard UI extensions to the specified plugin */
    dashboard?: string | boolean;
    /** Specify the path to a custom Vendure config file */
    config?: string;
    /** Name for the job queue (used with jobQueue) */
    name?: string;
    /** Name for the query (used with apiExtension) */
    queryName?: string;
    /** Name for the mutation (used with apiExtension) */
    mutationName?: string;
    /** Name of the service to use (used with jobQueue) */
    selectedService?: string;
    /** Selected plugin name for entity/service commands */
    selectedPlugin?: string;
    /** Add custom fields support to entity */
    customFields?: boolean;
    /** Make entity translatable */
    translatable?: boolean;
    /** Service type: basic or entity */
    type?: string;
    /** Selected entity name for entity service commands */
    selectedEntity?: string;
}

export async function addCommand(options?: AddOptions) {
    // If any non-interactive option is supplied, we switch to the non-interactive path
    const nonInteractive = options && Object.values(options).some(v => v !== undefined && v !== false);

    if (nonInteractive) {
        await handleNonInteractiveMode(options);
    } else {
        await handleInteractiveMode();
    }
}

async function handleNonInteractiveMode(options: AddOptions) {
    try {
        // Route to the appropriate function based on which flag was set
        if (options.plugin) {
            // Validate that a plugin name was provided
            if (typeof options.plugin !== 'string' || !options.plugin.trim()) {
                throw new Error('Plugin name is required. Usage: vendure add -p <plugin-name>');
            }
            await createNewPlugin({ name: options.plugin, config: options.config });
            log.success(`Plugin "${options.plugin}" created successfully`);
        } else if (options.entity) {
            // Validate that an entity name was provided
            if (typeof options.entity !== 'string' || !options.entity.trim()) {
                throw new Error(
                    'Entity name is required. Usage: vendure add -e <entity-name> --selected-plugin <plugin-name>',
                );
            }
            // Validate that a plugin name was provided for non-interactive mode
            if (
                !options.selectedPlugin ||
                typeof options.selectedPlugin !== 'string' ||
                !options.selectedPlugin.trim()
            ) {
                throw new Error(
                    'Plugin name is required when running in non-interactive mode. Usage: vendure add -e <entity-name> --selected-plugin <plugin-name>',
                );
            }
            await addEntity({
                className: options.entity,
                isNonInteractive: true,
                config: options.config,
                pluginName: options.selectedPlugin,
                customFields: options.customFields,
                translatable: options.translatable,
            });
            log.success(
                `Entity "${options.entity}" added successfully to plugin "${options.selectedPlugin}"`,
            );
        } else if (options.service) {
            // Validate that a service name was provided
            if (typeof options.service !== 'string' || !options.service.trim()) {
                throw new Error(
                    'Service name is required. Usage: vendure add -s <service-name> --selected-plugin <plugin-name>',
                );
            }
            // Validate that a plugin name was provided for non-interactive mode
            if (
                !options.selectedPlugin ||
                typeof options.selectedPlugin !== 'string' ||
                !options.selectedPlugin.trim()
            ) {
                throw new Error(
                    'Plugin name is required when running in non-interactive mode. Usage: vendure add -s <service-name> --selected-plugin <plugin-name>',
                );
            }
            await addService({
                serviceName: options.service,
                isNonInteractive: true,
                config: options.config,
                pluginName: options.selectedPlugin,
                serviceType: options.selectedEntity ? 'entity' : options.type || 'basic',
                selectedEntityName: options.selectedEntity,
            });
            log.success(
                `Service "${options.service}" added successfully to plugin "${options.selectedPlugin}"`,
            );
        } else if (options.jobQueue) {
            const pluginName = typeof options.jobQueue === 'string' ? options.jobQueue : undefined;
            // Validate required parameters for job queue
            if (!options.name || typeof options.name !== 'string' || !options.name.trim()) {
                throw new Error(
                    'Job queue name is required. Usage: vendure add -j [plugin-name] --name <job-name>',
                );
            }
            if (
                !options.selectedService ||
                typeof options.selectedService !== 'string' ||
                !options.selectedService.trim()
            ) {
                throw new Error(
                    'Service name is required for job queue. Usage: vendure add -j [plugin-name] --name <job-name> --selected-service <service-name>',
                );
            }
            await addJobQueue({
                isNonInteractive: true,
                config: options.config,
                pluginName,
                name: options.name,
                selectedService: options.selectedService,
            });
            log.success('Job-queue feature added successfully');
        } else if (options.codegen) {
            const pluginName = typeof options.codegen === 'string' ? options.codegen : undefined;
            // For codegen, if a boolean true is passed, plugin selection will be handled interactively
            // If a string is passed, it should be a valid plugin name
            if (typeof options.codegen === 'string' && !options.codegen.trim()) {
                throw new Error(
                    'Plugin name cannot be empty when specified. Usage: vendure add --codegen [plugin-name]',
                );
            }
            await addCodegen({
                isNonInteractive: true,
                config: options.config,
                pluginName,
            });
            log.success('Codegen configuration added successfully');
        } else if (options.apiExtension) {
            const pluginName = typeof options.apiExtension === 'string' ? options.apiExtension : undefined;
            // Validate that at least one of queryName or mutationName is provided and not empty
            const hasValidQueryName =
                options.queryName && typeof options.queryName === 'string' && options.queryName.trim() !== '';
            const hasValidMutationName =
                options.mutationName &&
                typeof options.mutationName === 'string' &&
                options.mutationName.trim() !== '';

            if (!hasValidQueryName && !hasValidMutationName) {
                throw new Error(
                    'At least one of query-name or mutation-name must be specified as a non-empty string. ' +
                        'Usage: vendure add -a [plugin-name] --query-name <name> --mutation-name <name>',
                );
            }

            // If a string is passed for apiExtension, it should be a valid plugin name
            if (typeof options.apiExtension === 'string' && !options.apiExtension.trim()) {
                throw new Error(
                    'Plugin name cannot be empty when specified. ' +
                        'Usage: vendure add -a [plugin-name] --query-name <name> --mutation-name <name>',
                );
            }

            await addApiExtension({
                isNonInteractive: true,
                config: options.config,
                pluginName,
                queryName: options.queryName,
                mutationName: options.mutationName,
                selectedService: options.selectedService,
            });
            log.success('API extension scaffold added successfully');
        } else if (options.uiExtensions) {
            const pluginName = typeof options.uiExtensions === 'string' ? options.uiExtensions : undefined;
            // For UI extensions, if a boolean true is passed, plugin selection will be handled interactively
            // If a string is passed, it should be a valid plugin name
            if (typeof options.uiExtensions === 'string' && !options.uiExtensions.trim()) {
                throw new Error(
                    'Plugin name cannot be empty when specified. Usage: vendure add --ui-extensions [plugin-name]',
                );
            }
            await addUiExtensions({
                isNonInteractive: true,
                config: options.config,
                pluginName,
            });
            log.success('UI extensions added successfully');
        } else if (options.dashboard) {
            const pluginName = typeof options.dashboard === 'string' ? options.dashboard : undefined;
            // For UI extensions, if a boolean true is passed, plugin selection will be handled interactively
            // If a string is passed, it should be a valid plugin name
            if (typeof options.uiExtensions === 'string' && !options.uiExtensions.trim()) {
                throw new Error(
                    'Plugin name cannot be empty when specified. Usage: vendure add --dashboard [plugin-name]',
                );
            }
            await addDashboard({
                isNonInteractive: true,
                config: options.config,
                pluginName,
            });
            log.success('Dashboard extensions added successfully');
        } else {
            log.error('No valid add operation specified');
            process.exit(1);
        }
    } catch (e: any) {
        // For validation errors, show the full error with stack trace
        if (e.message.includes('Plugin name is required')) {
            // Extract error message and stack trace
            const errorMessage = e.message;
            const stackLines = e.stack.split('\n');
            const stackTrace = stackLines.slice(1).join('\n'); // Remove first line (error message)

            // Display stack trace first, then colored error message at the end
            log.error(stackTrace);
            log.error(''); // Add empty line for better readability
            log.error(pc.red('Error:') + ' ' + String(errorMessage));
        } else {
            log.error(e.message as string);
            if (e.stack) {
                log.error(e.stack);
            }
        }
        process.exit(1);
    }
}

async function handleInteractiveMode() {
    // eslint-disable-next-line no-console
    console.log(`\n`);
    intro(pc.blue("✨ Let's add a new feature to your Vendure project!"));

    // Derive interactive options from command declarations (single source of truth)
    const addCommandDef = cliCommands.find(cmd => cmd.name === 'add');
    const addOptions =
        addCommandDef?.options
            ?.filter(opt => opt.interactiveId && opt.interactiveFn)
            .map(opt => ({
                value: opt.interactiveId as string,
                label: `${pc.blue(opt.interactiveCategory as string)} ${opt.description}`,
                fn: opt.interactiveFn as () => Promise<any>,
            })) ?? [];

    const featureType = await withInteractiveTimeout(async () => {
        return await select({
            message: 'Which feature would you like to add?',
            options: addOptions.map(opt => ({
                value: opt.value,
                label: opt.label,
            })),
        });
    });

    if (isCancel(featureType)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    try {
        const selectedOption = addOptions.find(opt => opt.value === featureType);
        if (!selectedOption) {
            throw new Error(`Could not find command with id "${featureType as string}"`);
        }
        const { modifiedSourceFiles, project } = await selectedOption.fn();

        if (modifiedSourceFiles.length) {
            const importsSpinner = spinner();
            importsSpinner.start('Organizing imports...');
            await pauseForPromptDisplay();
            for (const sourceFile of modifiedSourceFiles) {
                sourceFile.organizeImports();
            }
            await project.save();
            importsSpinner.stop('Imports organized');
        }
        outro('✅ Done!');
    } catch (e: any) {
        log.error(e.message as string);
        const isCliMessage = Object.values(Messages).includes(e.message);
        if (!isCliMessage && e.stack) {
            log.error(e.stack);
        }
        outro('❌ Error');
    }
}
