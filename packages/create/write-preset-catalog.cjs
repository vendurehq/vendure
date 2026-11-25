const fs = require('fs');
const path = require('path');

/**
 * Writes `assets/presets.json`: the base-data presets of the `@vendure/core` version create
 * installs. Create cannot load `@vendure/core` before the project is installed, so it validates
 * `--preset` against this list. The two packages share one version, and core is built before
 * create. `build.cts` and the vitest setup both call this.
 */
module.exports = function writePresetCatalog(createRoot) {
    const { listPresets } = require(
        path.join(createRoot, '../core/dist/data-import/presets/preset-registry.js'),
    );
    const target = path.join(createRoot, 'assets/presets.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(listPresets(), null, 2) + '\n');
};
