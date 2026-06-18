import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultJobQueuePlugin, dummyPaymentHandler, VendureConfig } from '@vendure/core';

export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
    },
    dbConnectionOptions: {
        synchronize: true,
        type: 'mariadb',
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        password: '',
        database: 'vendure-dev',
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    // When adding or altering custom field definitions, the database will
    // need to be updated. See the "Migrations" section in README.md.
    customFields: {},
    plugins: [
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        AdminUiPlugin.init({
            route: 'admin',
            port: 3002,
            adminUiConfig: {
                apiPort: 3000,
            },
        }),
    ],
};
