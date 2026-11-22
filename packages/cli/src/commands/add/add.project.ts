import { ErrorResult, fail } from '@vendure/common/lib/command';
import { Project, SourceFile } from 'ts-morph';

import { openProject } from '../../shared/open-project.js';
import { ServiceRef } from '../../shared/service-ref.js';
import { VendurePluginRef } from '../../shared/vendure-plugin-ref.js';
import { getPluginClasses } from '../../utilities/ast-utils.js';

import { entityNotFound, pluginAmbiguous, pluginNotFound, serviceNotFound } from './add.errors.js';

/** The names of the plugin classes in the project. */
export async function listPluginNames(): Promise<string[]> {
    const { project } = await openProject();
    return pluginNames(project);
}

/** The services of a plugin, for the `choices` of a field. Empty when the plugin is not found. */
export async function listServiceNames(input: Record<string, unknown>): Promise<string[]> {
    if (typeof input.plugin !== 'string') {
        return [];
    }
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    return plugin instanceof VendurePluginRef ? pluginServices(project, plugin).map(s => s.name) : [];
}

/** The entities of a plugin, without translation entities, for the `choices` of a field. */
export async function listEntityNames(input: Record<string, unknown>): Promise<string[]> {
    if (typeof input.plugin !== 'string') {
        return [];
    }
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    return plugin instanceof VendurePluginRef
        ? plugin
              .getEntities()
              .filter(e => !e.isTranslation())
              .map(e => e.name)
        : [];
}

function pluginNames(project: Project): string[] {
    const names = getPluginClasses(project)
        .map(plugin => plugin.getName())
        .filter((name): name is string => !!name);
    return [...new Set(names)];
}

/**
 * The plugin class with this name, or a coded error: one that lists the plugins there are, or one
 * that lists the files when more than one class has the name.
 */
export function findPlugin(project: Project, name: string): VendurePluginRef | ErrorResult {
    const matches = getPluginClasses(project).filter(c => c.getName() === name);
    if (matches.length > 1) {
        return fail(pluginAmbiguous, {
            plugin: name,
            files: matches.map(c => c.getSourceFile().getFilePath()),
        });
    }
    return matches.length
        ? new VendurePluginRef(matches[0])
        : fail(pluginNotFound, { plugin: name, available: pluginNames(project) });
}

/** The services that live in the directory of a plugin. */
export function pluginServices(project: Project, plugin: VendurePluginRef): ServiceRef[] {
    const pluginDir = plugin.getSourceFile().getDirectoryPath();
    return getServices(project).filter(s => {
        const dir = s.classDeclaration.getSourceFile().getDirectoryPath();
        // `startsWith(pluginDir)` alone would also match a sibling such as `reviews` for `review`.
        return dir === pluginDir || dir.startsWith(`${pluginDir}/`);
    });
}

/** The service of a plugin with this name, or the coded error that lists its services. */
export function findService(
    project: Project,
    plugin: VendurePluginRef,
    name: string,
): ServiceRef | ErrorResult {
    const services = pluginServices(project, plugin);
    return (
        services.find(s => s.name === name) ??
        fail(serviceNotFound, { service: name, plugin: plugin.name, available: services.map(s => s.name) })
    );
}

/** The entity of a plugin with this name, or the coded error that lists its entities. */
export function findEntity(plugin: VendurePluginRef, name: string) {
    const entities = plugin.getEntities().filter(e => !e.isTranslation());
    return (
        entities.find(e => e.name === name) ??
        fail(entityNotFound, { entity: name, plugin: plugin.name, available: entities.map(e => e.name) })
    );
}

/**
 * Saves what a command changed, and returns the paths of the changed files. The imports of the
 * files in `organize`, the ones the command wrote from a template, are organized first. Files the
 * command only edited, such as the plugin class, keep their imports as they are.
 */
export async function saveChanges(
    project: Project,
    changes: { organize: SourceFile[]; edited?: SourceFile[] },
): Promise<string[]> {
    const live = (files: SourceFile[]) => files.filter(f => !f.wasForgotten());
    for (const file of live(changes.organize)) {
        file.organizeImports();
    }
    await project.save();
    return [...new Set(live([...changes.organize, ...(changes.edited ?? [])]).map(f => f.getFilePath()))];
}

/** The `@Injectable` classes in the `service` and `services` directories of the project. */
function getServices(project: Project): ServiceRef[] {
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
