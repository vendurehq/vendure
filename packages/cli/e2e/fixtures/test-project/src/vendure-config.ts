import { VendureConfig } from '@vendure/core';
import * as path from 'node:path';

export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
    },
    dbConnectionOptions: {
        type: 'better-sqlite3',
        database: path.join(__dirname, '../test.db'),
        synchronize: false,
        logging: false,
        migrations: [path.join(__dirname, '../migrations/*.ts')],
    },
    authOptions: {
        tokenMethod: 'bearer',
    },
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    plugins: [],
};
