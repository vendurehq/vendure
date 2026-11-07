import { bootstrap, JobQueueService, runMigrations } from '@vendure/core';

import { devConfig } from './dev-config';

/**
 * This bootstraps the dev server, used for testing Vendure during development.
 */
runMigrations(devConfig)
    // rawBody：微信支付 V3 回调验签必须基于原始报文字节，JSON.stringify 往返会因空白差异导致验签失败
    .then(() => bootstrap(devConfig, { nestApplicationOptions: { rawBody: true } }))
    .then(app => {
        if (process.env.RUN_JOB_QUEUE === '1') {
            return app.get(JobQueueService).start();
        }
    })
    .catch(err => {
        // eslint-disable-next-line
        console.log(err);
        process.exit(1);
    });
