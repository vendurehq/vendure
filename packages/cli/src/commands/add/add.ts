import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import type { CommandDefinition } from '@vendure/common/lib/command';
import pc from 'picocolors';

import { hostErrors } from '../../command-host/host-errors.js';
import { runCoreCommand } from '../../command-host/run-core-command.js';
import { pascalCaseRegex, pluginNameRegex } from '../../constants.js';
import { rethrowCliCommandExit } from '../../shared/cli-command-exit.js';
import { kebabCase, pascalCase } from '../../utilities/case-utils.js';
import { abortIfNonInteractive, withInteractiveTimeout } from '../../utilities/utils.js';

import { addApiExtensionDefinition } from './api-extension/add-api-extension.command.js';
import { addCodegenDefinition } from './codegen/add-codegen.command.js';
import { addCommandDef } from './command.js';
import { addDashboardDefinition } from './dashboard/add-dashboard.command.js';
import { addEntityDefinition } from './entity/add-entity.command.js';
import { addJobQueueDefinition } from './job-queue/add-job-queue.command.js';
import { addPlatform } from './platform/add-platform.js';
import { addPluginDefinition } from './plugin/create-new-plugin.command.js';
import { addServiceDefinition } from './service/add-service.command.js';

const cancelledMessage = 'Add feature cancelled.';

interface MenuFeature {
    value: string;
    category: string;
    definition: CommandDefinition;
}

function feature(category: string, definition: CommandDefinition): MenuFeature {
    return { value: definition.path.join('-'), category, definition };
}

const pluginFeature = feature('Plugin', addPluginDefinition);

/** What a plugin can get once it exists, in the order the menus offer them. */
const pluginFeatures = [
    feature('Plugin: Entity', addEntityDefinition),
    feature('Plugin: Service', addServiceDefinition),
    feature('Plugin: API', addApiExtensionDefinition),
    feature('Plugin: Job Queue', addJobQueueDefinition),
    feature('Plugin: Dashboard', addDashboardDefinition),
    feature('Project: Codegen', addCodegenDefinition),
];

/** The `vendure add` subcommands the menu offers, after the Platform entry. */
const menuFeatures = [pluginFeature, ...pluginFeatures];

function label(menuFeature: MenuFeature): string {
    return `${pc.blue(menuFeature.category)} ${menuFeature.definition.description}`;
}

export interface AddOptions {
    /** Link to Vendure Console, start the Platform trial and install Platform */
    platform?: boolean;
    /** Create a new plugin with the given name */
    plugin?: string;
    /** Add a new entity class with the given name */
    entity?: string;
    /** Add a new service with the given name */
    service?: string;
    /** Add a job-queue handler to the specified plugin */
    jobQueue?: string | boolean;
    /** Add an API extension scaffold to the specified plugin */
    apiExtension?: string | boolean;
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
    /** Name of the service to use (used with jobQueue and apiExtension) */
    selectedService?: string;
    /** Selected plugin name for entity/service commands */
    selectedPlugin?: string;
    /** Add custom fields support to entity */
    customFields?: boolean;
    /** Make entity translatable */
    translatable?: boolean;
    /** Selected entity name for entity service commands */
    selectedEntity?: string;
}

/**
 * The older flags never checked names, so `vendure add -p MyPlugin` worked. A name that does not
 * fit the subcommand is converted to the form it takes: kebab case for a plugin, which still
 * makes `MyPlugin`, and PascalCase for an entity or a service. A name that fits is kept as typed.
 */
function pluginName(value: string): string {
    return pluginNameRegex.test(value) ? value : kebabCase(value);
}

function className(value: string): string {
    return pascalCaseRegex.test(value) ? value : pascalCase(value);
}

/** The plugin named by an optional-value flag such as `--dashboard [plugin]`. */
function pluginOf(value: string | boolean | undefined): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/**
 * The `vendure add` subcommand and input an older flag stands for, such as
 * `vendure add -e Review --selected-plugin ReviewsPlugin` for `vendure add entity`.
 */
export function commandForFlags(
    options: AddOptions,
): { path: string[]; input: Record<string, unknown> } | undefined {
    if (options.plugin) {
        return {
            path: ['add', 'plugin'],
            input: { name: pluginName(options.plugin), config: options.config },
        };
    }
    if (options.entity) {
        return {
            path: ['add', 'entity'],
            input: {
                name: className(options.entity),
                plugin: options.selectedPlugin,
                customFields: options.customFields,
                translatable: options.translatable,
            },
        };
    }
    if (options.service) {
        return {
            path: ['add', 'service'],
            input: {
                name: className(options.service),
                plugin: options.selectedPlugin,
                entity: options.selectedEntity,
            },
        };
    }
    if (options.jobQueue) {
        return {
            path: ['add', 'job-queue'],
            input: {
                plugin: pluginOf(options.jobQueue),
                service: options.selectedService,
                name: options.name,
            },
        };
    }
    if (options.apiExtension) {
        return {
            path: ['add', 'api-extension'],
            input: {
                plugin: pluginOf(options.apiExtension),
                service: options.selectedService,
                queryName: options.queryName,
                mutationName: options.mutationName,
            },
        };
    }
    if (options.dashboard) {
        return { path: ['add', 'dashboard'], input: { plugin: pluginOf(options.dashboard) } };
    }
    return undefined;
}

/**
 * `vendure add` with a flag runs the subcommand the flag stands for. Without one, it shows the
 * menu. Every entry except the Platform one runs a `vendure add` subcommand through the command
 * host, which asks for what is missing.
 */
export async function addCommand(options: AddOptions = {}): Promise<number> {
    if (options.platform) {
        await addPlatform();
        return 0;
    }
    const command = commandForFlags(options);
    if (command) {
        return (await runCoreCommand(command.path, command.input)).exitCode;
    }
    return handleInteractiveMode(options);
}

async function handleInteractiveMode(options: AddOptions): Promise<number> {
    if (
        abortIfNonInteractive('vendure add', [
            'vendure add plugin reviews',
            'vendure add entity ProductReview --plugin ReviewsPlugin',
            'vendure add service ReviewService --plugin ReviewsPlugin',
        ])
    ) {
        return 1;
    }

    // eslint-disable-next-line no-console
    console.log(`\n`);
    intro(pc.blue("✨ Let's add a new feature to your Vendure project!"));

    const platformOption = addCommandDef.options?.find(option => option.long === '--platform');
    const featureType = await withInteractiveTimeout(() =>
        select({
            message: 'Which feature would you like to add?',
            options: [
                // First, so it is the default entry of the menu.
                { value: 'add-platform', label: platformOption?.description ?? 'Vendure Platform features' },
                ...menuFeatures.map(f => ({ value: f.value, label: label(f) })),
            ],
        }),
    );
    if (isCancel(featureType)) {
        cancel(cancelledMessage);
        return 0;
    }
    try {
        if (featureType === 'add-platform') {
            await addPlatform();
            outro('✅ Done!');
            return 0;
        }
        const chosen = menuFeatures.find(f => f.value === featureType);
        if (!chosen) {
            throw new Error(`Could not find command with id "${String(featureType)}"`);
        }
        const input = chosen === pluginFeature ? { config: options.config } : {};
        const result = await runCoreCommand(chosen.definition.path, input);
        // The host has already said that the command was cancelled.
        if (result.envelope.error?.code === hostErrors.cancelled.code) {
            return 0;
        }
        if (result.exitCode === 0 && chosen === pluginFeature) {
            await addFeaturesToNewPlugin((result.envelope.output as { plugin: string }).plugin);
        }
        outro(result.exitCode === 0 ? '✅ Done!' : '❌ Error');
        return result.exitCode;
    } catch (e: unknown) {
        rethrowCliCommandExit(e);
        log.error(e instanceof Error ? e.message : String(e));
        outro('❌ Error');
        return 1;
    }
}

/** Offers the features a new plugin can get, one at a time, until the person is done. */
async function addFeaturesToNewPlugin(plugin: string): Promise<void> {
    for (;;) {
        const featureType = await withInteractiveTimeout(() =>
            select({
                message: `Add features to ${plugin}?`,
                options: [
                    { value: 'no', label: "[Finish] No, I'm done!" },
                    ...pluginFeatures.map(f => ({
                        value: f.value,
                        label: `[${f.category}] ${f.definition.description}`,
                    })),
                ],
            }),
        );
        const chosen = pluginFeatures.find(f => f.value === featureType);
        if (isCancel(featureType) || !chosen) {
            return;
        }
        // A failed feature is reported by the host; the person can still add the others.
        await runCoreCommand(chosen.definition.path, { plugin });
    }
}
