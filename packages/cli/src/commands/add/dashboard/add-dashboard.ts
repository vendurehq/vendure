import fs from 'fs-extra';
import path from 'node:path';
import { SourceFile } from 'ts-morph';

import { VendurePluginRef } from '../../../shared/vendure-plugin-ref.js';
import { createFile } from '../../../utilities/ast-utils.js';

/**
 * Adds Dashboard extensions to a plugin: the `dashboard` metadata property, and
 * `dashboard/index.tsx` when it does not exist yet. It prints nothing and does not save.
 * It throws when the plugin's `dashboard` property already points somewhere else.
 */
export function scaffoldDashboard(plugin: VendurePluginRef): { changed: SourceFile[]; entrypoint: string } {
    plugin.addMetadataProperty('dashboard', './dashboard/index.tsx');
    const entrypoint = path.join(plugin.getPluginDir().getPath(), 'dashboard', 'index.tsx');
    const changed = [plugin.classDeclaration.getSourceFile()];
    if (!fs.existsSync(entrypoint)) {
        changed.push(
            createFile(
                plugin.getSourceFile().getProject(),
                path.join(import.meta.dirname, 'templates/index.template.tsx'),
                entrypoint,
            ),
        );
    }
    return { changed, entrypoint };
}
