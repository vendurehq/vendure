import fs from 'fs-extra';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const writePresetCatalog = require('./write-preset-catalog.cjs') as (createRoot: string) => void;

fs.remove('./assets')
    .then(() => fs.copy('./templates', './assets'))
    .then(() => writePresetCatalog(__dirname))
    .then(() => process.exit(0))
    .catch(err => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    });
