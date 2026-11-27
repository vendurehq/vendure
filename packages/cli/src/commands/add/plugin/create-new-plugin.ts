import path from 'path';
import { Project, SourceFile } from 'ts-morph';

import { VendurePluginRef } from '../../../shared/vendure-plugin-ref.js';
import { createFile, getPluginClasses } from '../../../utilities/ast-utils.js';
import { constantCase, kebabCase, pascalCase } from '../../../utilities/case-utils.js';

import { GeneratePluginOptions, NewPluginTemplateContext } from './types.js';

/**
 * Creates the files of a new plugin in `options.pluginDir`: the plugin class, its options type
 * and its constants. It prints nothing and does not save.
 */
export function scaffoldPlugin(
    project: Project,
    options: GeneratePluginOptions,
): { plugin: VendurePluginRef; created: SourceFile[] } {
    const nameWithoutPlugin = options.name.replace(/-?plugin$/i, '');
    const normalizedName = nameWithoutPlugin + '-plugin';
    const templateContext: NewPluginTemplateContext = {
        ...options,
        pluginName: pascalCase(normalizedName),
        pluginInitOptionsName: constantCase(normalizedName) + '_OPTIONS',
    };

    const pluginFile = createFile(
        project,
        path.join(import.meta.dirname, 'templates/plugin.template.ts'),
        path.join(options.pluginDir, kebabCase(nameWithoutPlugin) + '.plugin.ts'),
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
        path.join(import.meta.dirname, 'templates/types.template.ts'),
        path.join(options.pluginDir, 'types.ts'),
    );

    const constantsFile = createFile(
        project,
        path.join(import.meta.dirname, 'templates/constants.template.ts'),
        path.join(options.pluginDir, 'constants.ts'),
    );
    constantsFile
        .getVariableDeclaration('TEMPLATE_PLUGIN_OPTIONS')
        ?.rename(templateContext.pluginInitOptionsName)
        .set({ initializer: `Symbol('${templateContext.pluginInitOptionsName}')` });
    constantsFile
        .getVariableDeclaration('loggerCtx')
        ?.set({ initializer: `'${templateContext.pluginName}'` });

    return {
        created: [pluginFile, typesFile, constantsFile],
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

/**
 * Where a new plugin goes: next to the existing plugins when there are any, else in
 * `src/plugins` of the Vendure project.
 */
export function defaultPluginDir(project: Project, name: string, vendureProjectDir: string): string {
    return getPluginDirName(name, findExistingPluginsDir(project), vendureProjectDir);
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
            kebabCase(nameWithoutPlugin),
            existingPluginDirPattern.suffix,
        );
    } else {
        // Use the Vendure project directory (which may be in a monorepo package)
        // instead of cwd (which could be the monorepo root)
        return path.join(vendureProjectDir, 'src', 'plugins', kebabCase(nameWithoutPlugin));
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
