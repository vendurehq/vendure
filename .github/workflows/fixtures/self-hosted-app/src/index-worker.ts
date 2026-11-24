/* eslint-disable no-console */
import { bootstrapWorker } from '@vendure/core';

import { config } from './vendure-config';

bootstrapWorker(config)
    .then(worker => worker.startJobQueue())
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
