import { dummyPaymentHandler, VendureConfig } from '@vendure/core';
import * as path from 'node:path';

// The database is created by the spec, with `synchronize`, before `vendure seed` runs.
export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
    },
    dbConnectionOptions: {
        type: 'better-sqlite3',
        database: path.join(__dirname, '../seed.db'),
        synchronize: true,
        logging: false,
    },
    authOptions: {
        tokenMethod: 'bearer',
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    plugins: [],
};
