import { cp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

/**
 * The specs read the templates and the preset list from `assets/`, which is gitignored and
 * produced by the `copy-assets` build step. CI runs the unit tests without that step, so this does
 * the same work: it copies the templates and writes the presets of the built `@vendure/core`,
 * which the test target builds first.
 */
export async function setup({ config }: TestProject): Promise<void> {
    await cp(path.join(config.root, 'templates'), path.join(config.root, 'assets'), {
        recursive: true,
        force: true,
    });
    const require = createRequire(import.meta.url);
    const { listPresets } = require(
        path.join(config.root, '../core/dist/data-import/presets/preset-registry.js'),
    ) as { listPresets: () => unknown };
    await writeFile(
        path.join(config.root, 'assets/presets.json'),
        JSON.stringify(listPresets(), null, 2) + '\n',
    );
}
