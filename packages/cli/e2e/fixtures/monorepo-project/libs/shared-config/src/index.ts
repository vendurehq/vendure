import { loadTenantSettings } from '@example/tenant-settings';
import { VendureConfig } from '@vendure/core';
import * as path from 'node:path';

const serverDir = path.join(__dirname, '../../../apps/server');

/**
 * Builds the Vendure config of the server at run time, from the secrets in the environment and
 * the settings of the tenant it runs for.
 */
export async function getVendureConfig(): Promise<VendureConfig> {
    const tenant = await loadTenantSettings(process.env.EXAMPLE_TENANT ?? 'default');
    return {
        apiOptions: {
            port: tenant.port,
            adminApiPath: 'admin-api',
            shopApiPath: 'shop-api',
        },
        dbConnectionOptions: {
            type: 'better-sqlite3',
            database: path.join(serverDir, tenant.databaseFile),
            synchronize: false,
            logging: false,
            migrations: [path.join(serverDir, 'migrations/*.ts')],
        },
        authOptions: {
            tokenMethod: 'bearer',
            cookieOptions: { secret: process.env.EXAMPLE_COOKIE_SECRET ?? 'not-a-secret' },
        },
        paymentOptions: {
            paymentMethodHandlers: [],
        },
        plugins: [],
    };
}
