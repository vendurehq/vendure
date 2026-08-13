import { RuntimeVendureConfig } from '@vendure/core';
import { DataSource } from 'typeorm';

import { CheckResult } from '../types';

/**
 * Checks database connectivity by attempting to connect using the
 * dbConnectionOptions from the loaded Vendure config.
 *
 * Currently only verifies that the database is reachable and accepts connections.
 * This is a read-only check -- it uses safe overrides to ensure
 * no schema changes, migrations, or data modifications occur.
 *
 * TODO: Future enhancements:
 * - Detect pending migrations (compare migration table vs registered migrations)
 * - Detect schema drift (use connection.driver.createSchemaBuilder().log()
 *   from the pattern in core/src/migrate.ts)
 * Both would require passing entities and using the createConnection pattern
 * from core/src/migrate.ts instead of an empty entity list.
 */
export async function runDatabaseCheck(config: RuntimeVendureConfig): Promise<CheckResult> {
    const details: string[] = [];
    const dbOptions = config.dbConnectionOptions;
    const dbType = (dbOptions as any).type || 'unknown';

    let dataSource: DataSource | undefined;
    try {
        // Connectivity check only -- entities are emptied to avoid TypeORM
        // metadata validation errors (e.g. plugin entities that require
        // NestJS module initialization to register their primary columns).
        dataSource = new DataSource(
            Object.assign({}, dbOptions, {
                entities: [],
                subscribers: [],
                synchronize: false,
                migrationsRun: false,
                dropSchema: false,
                logging: false,
            }) as any,
        );

        await dataSource.initialize();

        details.push(`Database type: ${dbType}`);
        if ((dbOptions as any).host) {
            details.push(`Host: ${(dbOptions as any).host}`);
        }
        if ((dbOptions as any).database) {
            details.push(`Database: ${(dbOptions as any).database}`);
        }

        return {
            name: 'Database',
            status: 'pass',
            message: `Successfully connected to ${dbType} database`,
            details,
        };
    } catch (e: any) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        details.push(`Database type: ${dbType}`);
        details.push(`Error: ${errorMessage}`);

        return {
            name: 'Database',
            status: 'warn',
            message: `Could not connect to ${dbType} database`,
            details,
        };
    } finally {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    }
}
