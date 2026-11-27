import fs from 'node:fs';
import path from 'node:path';

import type { ResolvedCommandManifest } from '../resolve-cli-plugins.js';

/**
 * An enabled package, written to `dir`. When `body` is given, its declarations module exports a
 * config resolver whose `resolve(ctx)` runs `body`, and its manifest has `hasConfigResolver`.
 */
export function configResolverPackage(
    dir: string,
    name: string,
    body?: string,
    scope: 'project' | 'global' = 'project',
): ResolvedCommandManifest {
    const definitionsPath = path.join(dir, `${name.replace(/\W/g, '-')}.mjs`);
    const resolver =
        body === undefined
            ? ''
            : `export const configResolver = { resolve: async () => ({ resolve: async ctx => { ${body} } }) };\n`;
    fs.writeFileSync(definitionsPath, `export const commands = [];\n${resolver}`);
    return {
        packageName: name,
        definitionsPath,
        scope,
        manifest: {
            manifestVersion: 1,
            package: name,
            version: '1.0.0',
            commands: [],
            ...(body === undefined ? {} : { hasConfigResolver: true as const }),
        },
    };
}
