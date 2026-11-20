import type { VendureConfig } from '@vendure/core';

import { loadVendureConfigFile } from '../../../shared/load-vendure-config-file.js';
import { openProject } from '../../../shared/open-project.js';
import { requireFromProjectCore } from '../../../shared/project-core.js';
import { VendureConfigRef } from '../../../shared/vendure-config-ref.js';

export interface LoadedProjectConfig {
    config: VendureConfig;
    /** The absolute path of the config file. */
    configPath: string;
}

/** Loads the project's Vendure config. It prints nothing. */
export async function loadProjectConfig(configFile?: string): Promise<LoadedProjectConfig> {
    const { project, tsConfigPath } = await openProject();
    const ref = new VendureConfigRef(project, configFile);
    const config = await loadVendureConfigFile(ref, tsConfigPath);
    return { config, configPath: ref.sourceFile.getFilePath() };
}

/** Which database the config points at, without credentials. */
export function describeDatabase(config: VendureConfig): {
    type: string;
    database?: string;
    host?: string;
    port?: number;
} {
    const options = config.dbConnectionOptions as unknown as Record<string, unknown>;
    return {
        type: String(options.type),
        ...(typeof options.database === 'string' ? { database: options.database } : {}),
        ...(typeof options.host === 'string' ? { host: options.host } : {}),
        ...(typeof options.port === 'number' ? { port: options.port } : {}),
    };
}

/**
 * The name of the last migration the database has applied, or `null` when none has been applied.
 * It throws when the database cannot be read.
 */
export async function lastAppliedMigration(config: VendureConfig): Promise<string | null> {
    const { DataSource } = requireFromProjectCore<typeof import('typeorm')>('typeorm');
    const dataSource = new DataSource({
        ...(config.dbConnectionOptions as object),
        entities: [],
        migrations: [],
        subscribers: [],
        synchronize: false,
        migrationsRun: false,
        logging: false,
    } as any);
    try {
        await dataSource.initialize();
        const table = dataSource.options.migrationsTableName ?? 'migrations';
        if (!(await dataSource.createQueryRunner().hasTable(table))) {
            return null;
        }
        const row = await dataSource
            .createQueryBuilder()
            .select('m.name', 'name')
            .from(table, 'm')
            .orderBy('m.id', 'DESC')
            .limit(1)
            .getRawOne<{ name: string }>();
        return row?.name ?? null;
    } finally {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    }
}
