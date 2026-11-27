import { createRequire } from 'node:module';
import type { TestProject } from 'vitest/node';

/**
 * The specs read the templates, the skills and the preset list from `assets/`, which is gitignored
 * and produced by the `copy-assets` build step. CI runs the unit tests without that step, so this
 * does the same work. The test target builds `@vendure/core` first, which the preset list comes
 * from.
 */
export function setup({ config }: TestProject): void {
    const prepareAssets = createRequire(import.meta.url)('./prepare-assets.cjs') as (
        createRoot: string,
        options: { clean: boolean },
    ) => void;
    prepareAssets(config.root, { clean: false });
}
