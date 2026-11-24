import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import {
    DefaultJobQueuePlugin,
    DefaultSchedulerPlugin,
    DefaultSearchPlugin,
    dummyPaymentHandler,
    VendureConfig,
} from '@vendure/core';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import path from 'path';

export const config: VendureConfig = {
    apiOptions: {
        port: 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        cors: { origin: true, credentials: true },
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: { identifier: 'superadmin', password: 'superadmin' },
        cookieOptions: { secret: 'test-app-cookie-secret' },
    },
    dbConnectionOptions: {
        type: 'better-sqlite3',
        // A test app with no migrations: the schema follows the configuration.
        synchronize: true,
        logging: false,
        database: path.join(__dirname, '../vendure.sqlite'),
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    // The Dashboard tests add a plugin to the end of this array, so it holds no nested array.
    plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, '../static/assets'),
        }),
        DefaultSchedulerPlugin.init(),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        DashboardPlugin.init({
            route: 'dashboard',
            appDir: path.join(__dirname, '../dist/dashboard'),
        }),
    ],
};
