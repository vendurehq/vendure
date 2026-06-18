import { cancel, isCancel, multiselect, select, spinner } from '@clack/prompts';
import path from 'node:path';
import pc from 'picocolors';
import { ClassDeclaration, Project } from 'ts-morph';

import { addServiceCommand } from '../commands/add/service/add-service';
import { Messages } from '../constants';
import { getPluginClasses, getTsMorphProject, selectTsConfigFile } from '../utilities/ast-utils';
import { pauseForPromptDisplay, withInteractiveTimeout } from '../utilities/utils';

import { EntityRef } from './entity-ref';
import { ServiceRef } from './service-ref';
import { VendurePluginRef } from './vendure-plugin-ref';

/**
 * Creates plugin selection options with duplicate name handling.
 * When multiple plugins share the same name, displays relative paths in dimmed text to distinguish them.
 */
function createPluginOptions(
    pluginClasses: ClassDeclaration[],
    project: Project,
): Array<{ value: ClassDeclaration; label: string }> {
    // Detect duplicate plugin names
    const pluginNames = pluginClasses.map(c => c.getName() as string);
    const nameCounts = pluginNames.reduce(
        (acc, name) => {
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        },
        {} as Record<string, number>,
    );

    const projectRoot =
        project.getDirectory('.')?.getPath() || project.getRootDirectories()[0]?.getPath() || '';

    return pluginClasses.map(c => {
        const name = c.getName() as string;
        const hasDuplicates = nameCounts[name] > 1;
        let label = pc.bold(name);
        if (hasDuplicates) {
            const fullPath = c.getSourceFile().getFilePath();
            const relativePath = path.relative(projectRoot, fullPath);
            label = `${pc.bold(name)} ${pc.dim(pc.italic(`(${relativePath})`))}`;
        }
        return {
            value: c,
            label,
        };
    });
}

export async function analyzeProject(options: {
    providedVendurePlugin?: VendurePluginRef;
    cancelledMessage?: string;
    config?: string;
}) {
    const providedVendurePlugin = options.providedVendurePlugin;
    let project = providedVendurePlugin?.classDeclaration.getProject();
    let tsConfigPath: string | undefined;
    let vendureTsConfig: string | undefined;
    let rootTsConfig: string | undefined;
    let isMonorepo: boolean | undefined;

    if (!providedVendurePlugin) {
        const projectSpinner = spinner();
        const tsConfigFile = selectTsConfigFile();
        projectSpinner.start('Analyzing project...');
        await pauseForPromptDisplay();
        const result = await getTsMorphProject(
            {
                compilerOptions: {
                    // When running via the CLI, we want to find all source files,
                    // not just the compiled .js files.
                    rootDir: './src',
                },
            },
            tsConfigFile,
        );
        project = result.project;
        tsConfigPath = result.tsConfigPath;
        vendureTsConfig = result.vendureTsConfig;
        rootTsConfig = result.rootTsConfig;
        isMonorepo = result.isMonorepo;
        projectSpinner.stop('Project analyzed');
    }
    return {
        project: project as Project,
        tsConfigPath,
        vendureTsConfig,
        rootTsConfig,
        isMonorepo,
        config: options.config,
    };
}

export async function selectPlugin(project: Project, cancelledMessage: string): Promise<VendurePluginRef> {
    const pluginClasses = getPluginClasses(project);
    if (pluginClasses.length === 0) {
        cancel(Messages.NoPluginsFound);
        process.exit(0);
    }

    const targetPlugin = await withInteractiveTimeout(async () => {
        return await select({
            message: 'To which plugin would you like to add the feature?',
            options: createPluginOptions(pluginClasses, project),
            maxItems: 10,
        });
    });

    if (isCancel(targetPlugin)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    return new VendurePluginRef(targetPlugin as ClassDeclaration);
}

export async function selectEntity(plugin: VendurePluginRef): Promise<EntityRef> {
    const entities = plugin.getEntities();
    if (entities.length === 0) {
        throw new Error(Messages.NoEntitiesFound);
    }

    const targetEntity = await withInteractiveTimeout(async () => {
        return await select({
            message: 'Select an entity',
            options: entities
                .filter(e => !e.isTranslation())
                .map(e => ({
                    value: e,
                    label: e.name,
                })),
            maxItems: 10,
        });
    });

    if (isCancel(targetEntity)) {
        cancel('Cancelled');
        process.exit(0);
    }
    return targetEntity as EntityRef;
}

export async function selectMultiplePluginClasses(
    project: Project,
    cancelledMessage: string,
): Promise<VendurePluginRef[]> {
    const pluginClasses = getPluginClasses(project);
    if (pluginClasses.length === 0) {
        cancel(Messages.NoPluginsFound);
        process.exit(0);
    }

    const selectAll = await withInteractiveTimeout(async () => {
        return await select({
            message: 'To which plugin would you like to add the feature?',
            options: [
                {
                    value: 'all',
                    label: 'All plugins',
                },
                {
                    value: 'specific',
                    label: 'Specific plugins (you will be prompted to select the plugins)',
                },
            ],
        });
    });

    if (isCancel(selectAll)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    if (selectAll === 'all') {
        return pluginClasses.map(pluginClass => new VendurePluginRef(pluginClass));
    }

    const targetPlugins = await withInteractiveTimeout(async () => {
        return await multiselect({
            message: 'Select one or more plugins (use ↑, ↓, space to select)',
            options: createPluginOptions(pluginClasses, project),
        });
    });

    if (isCancel(targetPlugins)) {
        cancel(cancelledMessage);
        process.exit(0);
    }
    return (targetPlugins as ClassDeclaration[]).map(pluginClass => new VendurePluginRef(pluginClass));
}

export async function selectServiceRef(
    project: Project,
    plugin: VendurePluginRef,
    canCreateNew = true,
): Promise<ServiceRef> {
    const serviceRefs = getServices(project).filter(sr => {
        return sr.classDeclaration
            .getSourceFile()
            .getDirectoryPath()
            .includes(plugin.getSourceFile().getDirectoryPath());
    });

    if (serviceRefs.length === 0 && !canCreateNew) {
        throw new Error(Messages.NoServicesFound);
    }

    const result = await withInteractiveTimeout(async () => {
        return await select({
            message: 'Which service contains the business logic for this API extension?',
            maxItems: 8,
            options: [
                ...(canCreateNew
                    ? [
                          {
                              value: 'new',
                              label: `Create new generic service`,
                          },
                      ]
                    : []),
                ...serviceRefs.map(sr => {
                    const features = sr.crudEntityRef
                        ? `CRUD service for ${sr.crudEntityRef.name}`
                        : `Generic service`;
                    const label = `${sr.name}: (${features})`;
                    return {
                        value: sr,
                        label,
                    };
                }),
            ],
        });
    });

    if (isCancel(result)) {
        cancel('Cancelled');
        process.exit(0);
    }
    if (result === 'new') {
        return addServiceCommand.run({ type: 'basic', plugin }).then(r => r.serviceRef);
    } else {
        return result as ServiceRef;
    }
}

export function getServices(project: Project): ServiceRef[] {
    const servicesSourceFiles = project.getSourceFiles().filter(sf => {
        return (
            sf.getDirectory().getPath().endsWith('/services') ||
            sf.getDirectory().getPath().endsWith('/service')
        );
    });

    return servicesSourceFiles
        .flatMap(sf => sf.getClasses())
        .filter(classDeclaration => classDeclaration.getDecorator('Injectable'))
        .map(classDeclaration => new ServiceRef(classDeclaration));
}
