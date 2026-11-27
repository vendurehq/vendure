const fs = require('node:fs');
const path = require('node:path');

/** The skills of the repository's `skills/` folder that every created project gets. */
const BUNDLED_SKILLS = ['vendure-cli', 'vendure-store-setup', 'vendure-troubleshooting'];

/**
 * Builds `assets/`, which create reads at run time. `build.cts` and the vitest setup both call it.
 *
 * - The templates, copied as they are.
 * - `skills/`: the bundled skills, copied from the repository's `skills/` folder.
 * - `presets.json`: the base-data presets of the `@vendure/core` version create installs. Create
 *   cannot load `@vendure/core` before the project is installed, so it validates `--preset`
 *   against this list. The two packages share one version, and core is built before create.
 */
module.exports = function prepareAssets(createRoot, { clean = true } = {}) {
    const assets = path.join(createRoot, 'assets');
    // The build starts from an empty folder, so a removed template or skill does not ship. The test
    // setup overwrites the templates and presets.json in place, so a build reading them at the same
    // time is not left with an empty folder, and rebuilds only skills/, which create copies by folder.
    if (clean) {
        fs.rmSync(assets, { recursive: true, force: true });
    } else {
        // Only the skills, which create copies by directory, so a removed skill does not linger.
        fs.rmSync(path.join(assets, 'skills'), { recursive: true, force: true });
    }
    fs.cpSync(path.join(createRoot, 'templates'), assets, { recursive: true });
    for (const skill of BUNDLED_SKILLS) {
        fs.cpSync(path.join(createRoot, '../../skills', skill), path.join(assets, 'skills', skill), {
            recursive: true,
        });
    }
    const { listPresets } = require(
        path.join(createRoot, '../core/dist/data-import/presets/preset-registry.js'),
    );
    fs.writeFileSync(path.join(assets, 'presets.json'), JSON.stringify(listPresets(), null, 2) + '\n');
};
