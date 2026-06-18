import { VendureConfig } from '@vendure/core';
import { preBootstrapConfig } from '@vendure/core/dist/bootstrap';
import { createConnection } from 'typeorm';

/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-floating-promises */
/**
 * Clears all tables in the database specified by the connectionOptions
 */
export async function clearAllTables(config: VendureConfig, logging = true) {
    if (logging) {
        console.log('Clearing all tables...');
    }
    config = await preBootstrapConfig(config);
    const entityIdStrategy = config.entityIdStrategy ?? config.entityOptions?.entityIdStrategy;
    const connection = await createConnection({ ...config.dbConnectionOptions });
    try {
        await connection.synchronize(true);
    } catch (err: any) {
        console.error('Error occurred when attempting to clear tables!');
        console.log(err);
    } finally {
        await connection.close();
    }
    if (logging) {
        console.log('Done!');
    }
}
