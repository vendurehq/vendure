import { bootstrapWorker } from '@vendure/core';

import { devConfig } from './dev-config';

bootstrapWorker(devConfig)
    .then(worker => worker.startJobQueue())
    // .then(worker => worker.startHealthCheckServer({ port: 3001 }))
    .catch(err => {
        // eslint-disable-next-line
        console.log(err);
        process.exit(1);
    });
