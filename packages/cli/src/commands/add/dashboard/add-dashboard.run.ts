import { fail, isErrorResult } from '@vendure/common/lib/command';

import { openProject } from '../../../shared/open-project.js';
import { findPlugin, saveChanges } from '../add.project.js';

import { dashboardConflict } from './add-dashboard.errors.js';
import { scaffoldDashboard } from './add-dashboard.js';

/** Adds Dashboard extensions to one plugin. */
export async function run(input: { plugin: string }) {
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    if (isErrorResult(plugin)) {
        return plugin;
    }
    let scaffolded: ReturnType<typeof scaffoldDashboard>;
    try {
        scaffolded = scaffoldDashboard(plugin);
    } catch (e) {
        return fail(dashboardConflict, {
            plugin: plugin.name,
            message: e instanceof Error ? e.message : String(e),
        });
    }
    return {
        plugin: plugin.name,
        entrypoint: scaffolded.entrypoint,
        modifiedFiles: await saveChanges(project, { organize: scaffolded.changed }),
    };
}
