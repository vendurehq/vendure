import { VendureConfig } from '@vendure/core';

export const testConfig: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
    },
    dbConnectionOptions: {
        type: 'better-sqlite3',
        database: ':memory:',
        synchronize: false,
        migrations: ['migrations/*.ts'],
    },
    authOptions: {
        tokenMethod: 'bearer',
    },
    paymentOptions: {
        paymentMethodHandlers: [],
    },
    plugins: [],
};
