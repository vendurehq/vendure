/* eslint-disable no-console */
import { bootstrap, DefaultLogger, LogLevel } from '@vendure/core';

import { config } from './src/vendure-config';

/** Creates the schema of an empty database, for a run that needs no sample data. */
bootstrap({
    ...config,
    dbConnectionOptions: { ...config.dbConnectionOptions, synchronize: true },
    logger: new DefaultLogger({ level: LogLevel.Warn }),
})
    .then(app => app.close())
    .then(() => process.exit(0))
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
