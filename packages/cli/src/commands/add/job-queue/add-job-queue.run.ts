import { isErrorResult } from '@vendure/common/lib/command';

import { openProject } from '../../../shared/open-project.js';
import { findPlugin, findService, saveChanges } from '../add.project.js';

import { scaffoldJobQueue } from './add-job-queue.js';

/** Adds a job queue to a service of a plugin. */
export async function run(input: { plugin: string; service: string; name: string }) {
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    if (isErrorResult(plugin)) {
        return plugin;
    }
    const serviceRef = findService(project, plugin, input.service);
    if (isErrorResult(serviceRef)) {
        return serviceRef;
    }
    const { triggerMethod } = scaffoldJobQueue(serviceRef, input.name);
    return {
        plugin: plugin.name,
        service: serviceRef.name,
        jobQueue: input.name,
        triggerMethod,
        // The service is the person's own file, so its imports are left as they are.
        modifiedFiles: await saveChanges(project, {
            organize: [],
            edited: [serviceRef.classDeclaration.getSourceFile()],
        }),
    };
}
