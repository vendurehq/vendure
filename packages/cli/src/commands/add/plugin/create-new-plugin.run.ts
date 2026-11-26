import { fail } from '@vendure/common/lib/command';
import fs from 'node:fs';
import path from 'node:path';

import {
    configResolverOwners,
    enabledManifests,
    withUnreadableManifests,
} from '../../../shared/load-project-config.js';
import { openProject } from '../../../shared/open-project.js';
import { VendureConfigNotDeclaredError, VendureConfigRef } from '../../../shared/vendure-config-ref.js';
import { addImportsToFile } from '../../../utilities/ast-utils.js';
import { fileExists } from '../add.errors.js';
import { saveChanges } from '../add.project.js';

import { vendureConfigNotFound } from './create-new-plugin.errors.js';
import { defaultPluginDir, scaffoldPlugin } from './create-new-plugin.js';

/** Creates a plugin and adds it to the `plugins` of the Vendure config. */
export async function run(input: { name: string; dir?: string; config?: string }) {
    const { project, vendureTsConfig } = await openProject();
    const vendureProjectDir = vendureTsConfig ? path.dirname(vendureTsConfig) : process.cwd();
    const pluginDir = path.resolve(input.dir ?? defaultPluginDir(project, input.name, vendureProjectDir));
    if (fs.existsSync(pluginDir)) {
        return fail(fileExists, { path: pluginDir });
    }
    let vendureConfig: VendureConfigRef;
    try {
        vendureConfig = new VendureConfigRef(project, input.config);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!(e instanceof VendureConfigNotDeclaredError)) {
            // Several config files are in the source, or the user named a --config file that is not
            // there. Either way the user chose a file, so the resolver hint does not apply.
            return fail(vendureConfigNotFound, { message });
        }
        // A config from a config resolver is not declared in the source, so there is nowhere to add
        // the plugin to. The resolver is not run: saying which package owns the config is enough.
        const { plugins, unreadable } = enabledManifests();
        const resolvers = configResolverOwners(plugins);
        const hint = resolvers.length
            ? `${message} This project's config may come from the config resolver of ${resolvers.join(' or ')}. ` +
              'This command can add a plugin only to a VendureConfig declared in the source.'
            : message;
        return fail(vendureConfigNotFound, {
            message: withUnreadableManifests(
                hint,
                unreadable,
                'so whether they provide the config is not known',
            ).message,
        });
    }
    const { plugin, created } = scaffoldPlugin(project, { name: input.name, pluginDir });
    vendureConfig.addToPluginsArray(`${plugin.name}.init({})`);
    addImportsToFile(vendureConfig.sourceFile, {
        moduleSpecifier: plugin.getSourceFile(),
        namedImports: [plugin.name],
    });
    return {
        plugin: plugin.name,
        dir: pluginDir,
        modifiedFiles: await saveChanges(project, { organize: created, edited: [vendureConfig.sourceFile] }),
    };
}
