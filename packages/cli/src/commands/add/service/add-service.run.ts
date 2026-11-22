import { fail, isErrorResult } from '@vendure/common/lib/command';
import fs from 'node:fs';

import { openProject } from '../../../shared/open-project.js';
import { fileExists } from '../add.errors.js';
import { findEntity, findPlugin, saveChanges } from '../add.project.js';

import { scaffoldService, serviceFilePath } from './add-service.js';

/** Adds a service to a plugin, as a CRUD service when an entity is given. */
export async function run(input: { name: string; plugin: string; entity?: string }) {
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    if (isErrorResult(plugin)) {
        return plugin;
    }
    const entityRef = input.entity ? findEntity(plugin, input.entity) : undefined;
    if (entityRef && isErrorResult(entityRef)) {
        return entityRef;
    }
    const file = serviceFilePath(plugin, input.name);
    if (fs.existsSync(file)) {
        return fail(fileExists, { path: file });
    }
    const { created, edited } = scaffoldService(project, plugin, { serviceName: input.name, entityRef });
    return {
        service: input.name,
        plugin: plugin.name,
        entity: entityRef?.name ?? null,
        modifiedFiles: await saveChanges(project, { organize: created, edited }),
    };
}
