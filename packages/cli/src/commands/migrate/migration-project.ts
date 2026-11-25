import { ErrorResult, fail } from '@vendure/common/lib/command';
import type { VendureConfig } from '@vendure/core';
import path from 'node:path';

import { loadVendureConfigFile } from '../../shared/load-vendure-config-file.js';
import { openProject } from '../../shared/open-project.js';
import { requireFromProjectCore } from '../../shared/project-core.js';
import { VendureConfigRef } from '../../shared/vendure-config-ref.js';

import { configUnreadable } from './migrate.errors.js';

export interface LoadedProjectConfig {
    config: VendureConfig;
    /** The absolute path of the config file. */
    configPath: string;
    ref: VendureConfigRef;
}

/** Loads the project's Vendure config. It prints nothing. */
export async function loadProjectConfig(configFile?: string): Promise<LoadedProjectConfig> {
    const { project, tsConfigPath } = await openProject();
    const ref = new VendureConfigRef(project, configFile);
    const config = await loadVendureConfigFile(ref, tsConfigPath);
    return { config, configPath: ref.sourceFile.getFilePath(), ref };
}

/**
 * Loads the project's Vendure config for a migrate command, or returns the coded error the
 * command reports when the config cannot be found or loaded.
 */
export async function openMigrationProject(configFile?: string): Promise<LoadedProjectConfig | ErrorResult> {
    try {
        return await loadProjectConfig(configFile);
    } catch (e) {
        return fail(configUnreadable, { message: e instanceof Error ? e.message : String(e) });
    }
}

/**
 * Where a new migration goes when no directory is given: the directory of the config's first
 * `migrations` pattern, else the directory of an existing migration class, else `migrations`
 * next to the config file's directory.
 */
export function defaultMigrationDir({ config, ref }: LoadedProjectConfig): string {
    const migrations = config.dbConnectionOptions.migrations;
    if (Array.isArray(migrations) && typeof migrations[0] === 'string') {
        return path.normalize(path.dirname(migrations[0]));
    }
    const migrationFile = ref.sourceFile
        .getProject()
        .getSourceFiles()
        .find(sf =>
            sf.getClasses().some(c => c.getImplements().some(i => i.getText() === 'MigrationInterface')),
        );
    if (migrationFile) {
        return path.normalize(migrationFile.getDirectory().getPath());
    }
    return path.normalize(path.join(ref.sourceFile.getDirectory().getPath(), '../migrations'));
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
 *
 * It finds the migrations table and the last migration the same way TypeORM's `MigrationExecutor`
 * does when it reverts: the table name with the configured schema and database, and the row with
 * the highest `id`. So the preview names the migration the revert undoes.
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
        const { driver } = dataSource;
        const tableName = dataSource.options.migrationsTableName ?? 'migrations';
        const table = driver.buildTableName(
            tableName,
            (driver.options as { schema?: string }).schema,
            driver.database,
        );
        const queryRunner = dataSource.createQueryRunner();
        try {
            if (!(await queryRunner.hasTable(table))) {
                return null;
            }
            const row = await dataSource
                .createQueryBuilder(queryRunner)
                .select('m.name', 'name')
                .from(table, 'm')
                .orderBy(`m.${driver.escape('id')}`, 'DESC')
                .limit(1)
                .getRawOne<{ name: string }>();
            return row?.name ?? null;
        } finally {
            await queryRunner.release();
        }
    } finally {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    }
}
