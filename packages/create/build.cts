import fs from 'fs-extra';
import path from 'path';

/**
 * The base-data presets of the `@vendure/core` version create installs. create cannot load
 * `@vendure/core` before the project is installed, so it validates `--preset` against this list.
 * The two packages share one version, and core is built before create.
 */
function writePresetCatalog() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { listPresets } = require(path.join(__dirname, '../core/dist/data-import/presets/preset-registry'));
    return fs.outputFile('./assets/presets.json', JSON.stringify(listPresets(), null, 2) + '\n', 'utf-8');
}

fs.remove('./assets')
    .then(() => fs.copy('./templates', './assets'))
    .then(writePresetCatalog)
    .then(() => process.exit(0))
    .catch(err => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    });
