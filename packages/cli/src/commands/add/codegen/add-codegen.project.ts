import { openProject } from '../../../shared/open-project.js';
import { getPluginClasses } from '../../../utilities/ast-utils.js';

/** The names of the plugin classes in the project. */
export async function listPluginNames(): Promise<string[]> {
    const { project } = await openProject();
    return getPluginClasses(project)
        .map(plugin => plugin.getName())
        .filter((name): name is string => !!name);
}
