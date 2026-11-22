import { fail, incomplete, isErrorResult } from '@vendure/common/lib/command';

import { openProject } from '../../../shared/open-project.js';
import { findPlugin, findService, saveChanges } from '../add.project.js';

import { apiExtensionFailed } from './add-api-extension.errors.js';
import { scaffoldApiExtension } from './add-api-extension.js';

/** Adds an Admin API extension to a plugin, with a resolver that calls one of its services. */
export async function run(input: {
    plugin: string;
    service: string;
    queryName?: string;
    mutationName?: string;
}) {
    const { project } = await openProject();
    const plugin = findPlugin(project, input.plugin);
    if (isErrorResult(plugin)) {
        return plugin;
    }
    const serviceRef = findService(project, plugin, input.service);
    if (isErrorResult(serviceRef)) {
        return serviceRef;
    }
    const crud = !!serviceRef.crudEntityRef;
    // Without an entity, the extension consists of the named operations, so it needs at least one.
    if (!crud && !input.queryName && !input.mutationName) {
        const why = `${serviceRef.name} is not a CRUD service, so the extension needs a query name, a mutation name, or both`;
        return incomplete([
            { kind: 'input', field: 'queryName', description: `A name for the query. ${why}` },
            { kind: 'input', field: 'mutationName', description: `A name for the mutation. ${why}` },
        ]);
    }
    let scaffolded: ReturnType<typeof scaffoldApiExtension>;
    try {
        scaffolded = scaffoldApiExtension(project, plugin, serviceRef, input);
    } catch (e) {
        return fail(apiExtensionFailed, {
            plugin: plugin.name,
            message: e instanceof Error ? e.message : String(e),
        });
    }
    const { resolver, organize, edited } = scaffolded;
    return {
        plugin: plugin.name,
        service: serviceRef.name,
        resolver,
        crud,
        modifiedFiles: await saveChanges(project, { organize, edited }),
    };
}
