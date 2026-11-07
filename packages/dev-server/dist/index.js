"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@vendure/core");
const dev_config_1 = require("./dev-config");
(0, core_1.runMigrations)(dev_config_1.devConfig)
    .then(() => (0, core_1.bootstrap)(dev_config_1.devConfig, { nestApplicationOptions: { rawBody: true } }))
    .then(app => {
    if (process.env.RUN_JOB_QUEUE === '1') {
        return app.get(core_1.JobQueueService).start();
    }
})
    .catch(err => {
    console.log(err);
    process.exit(1);
});
