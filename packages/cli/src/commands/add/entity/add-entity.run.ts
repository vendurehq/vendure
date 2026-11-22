import { fail, isErrorResult } from '@vendure/common/lib/command';
import fs from 'node:fs';

import { openProject } from '../../../shared/open-project.js';
import { fileExists } from '../add.errors.js';
import { findPlugin, saveChanges } from '../add.project.js';

import { entityFilePath, scaffoldEntity } from './add-entity.js';

/** Adds an entity class to a plugin, with its translation class when it is translatable. */
export async function run(input: {
    name: string;
    plugin: string;
    customFields?: boolean;
    translatable?: boolean;
}) {
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    if (isErrorResult(plugin)) {
        return plugin;
    }
    const file = entityFilePath(plugin, input.name);
    if (fs.existsSync(file)) {
        return fail(fileExists, { path: file });
    }
    const { created, edited } = scaffoldEntity(plugin, input.name, {
        customFields: input.customFields ?? false,
        translatable: input.translatable ?? false,
    });
    return {
        entity: input.name,
        plugin: plugin.name,
        modifiedFiles: await saveChanges(project, { organize: created, edited }),
    };
}
