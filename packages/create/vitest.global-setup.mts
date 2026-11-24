import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { TestProject } from 'vitest/node';

/**
 * The specs read the templates and the preset list from `assets/`, which is gitignored and
 * produced by the `copy-assets` build step. CI runs the unit tests without that step, so this does
 * the same work. The test target builds `@vendure/core` first, which the preset list comes from.
 */
export async function setup({ config }: TestProject): Promise<void> {
    await cp(path.join(config.root, 'templates'), path.join(config.root, 'assets'), {
        recursive: true,
        force: true,
    });
    const writePresetCatalog = createRequire(import.meta.url)('./write-preset-catalog.cjs') as (
        createRoot: string,
    ) => void;
    writePresetCatalog(config.root);
}
