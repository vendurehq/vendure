import { createRequire } from 'node:module';

import { defaultAssetsDir, main } from './cli.js';

const packageJson = createRequire(import.meta.url)('../package.json') as { version: string };

void main(process.argv, { version: packageJson.version, assetsDir: defaultAssetsDir() }).then(code => {
    process.exitCode = code;
});
