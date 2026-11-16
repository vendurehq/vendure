import { cp } from 'node:fs/promises';
import path from 'node:path';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * `generateSources()` reads its Handlebars templates from `assets/`, which is gitignored and
 * produced by the `copy-assets` build step. CI runs `lerna run ci` before `bun run test`, and
 * this package has no `ci` script, so without this the specs fail on a clean tree with
 * `ENOENT ... assets/index.hbs`.
 *
 * `copy-assets` itself cannot be used here: it also copies mock data out of `@vendure/core`,
 * which needs `@vendure/common` compiled first. The specs only need the templates, and this is
 * the same copy that `copy-assets` performs first.
 */
export async function setup({ config }: GlobalSetupContext): Promise<void> {
    await cp(path.join(config.root, 'templates'), path.join(config.root, 'assets'), {
        recursive: true,
        force: true,
    });
}
