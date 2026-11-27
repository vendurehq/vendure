/* eslint-disable no-console */
import { bootstrap } from '@vendure/core';

import { config } from './vendure-config';

bootstrap(config).catch(err => {
    console.log(err);
    process.exit(1);
});
