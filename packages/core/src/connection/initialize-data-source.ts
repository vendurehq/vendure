import { DataSource, DataSourceOptions, EntityMetadata } from 'typeorm';

import { Logger } from '../config/logger/vendure-logger';
import { getChannelAssignmentEntities } from '../entity/channel-assignment/channel-assignment-registry';
import { assertEntityIdColumnsMigrated } from '../migration-utils/v4_0_entity_id_foreign_keys';
import {
    findTimestampColumnsToMigrate,
    findTimestamptzColumnsDeclaredAsTimestamp,
} from '../migration-utils/v4_0_timestamptz';

import { getDriverTimezone, isMysqlDatabase, isPostgresDatabase, isUtcTimezone } from './timezone-utils';

/**
 * @description
 * Creates and initializes a TypeORM DataSource, like `new DataSource(options).initialize()`, but
 * applies {@link alignChannelAssignmentMetadata} after the entity metadata is built and before
 * migrations and schema synchronization run.
 *
 * It keeps TypeORM's behaviour otherwise: `dropSchema` runs during initialization, then
 * `migrationsRun`, then `synchronize`, and the DataSource is destroyed if any of them fails.
 */
export async function initializeDataSource(options: DataSourceOptions): Promise<DataSource> {
    const dataSource = new DataSource({ ...options, synchronize: false, migrationsRun: false });
    pinMysqlSessionTimezone(dataSource);
    await dataSource.initialize();
    try {
        alignChannelAssignmentMetadata(dataSource);
        // Restore the configured values, which other code reads from the DataSource
        Object.assign(dataSource.options, {
            synchronize: options.synchronize,
            migrationsRun: options.migrationsRun,
        });
        if (options.migrationsRun) {
            await dataSource.runMigrations({ transaction: options.migrationsTransactionMode });
        }
        if (options.synchronize) {
            await assertDateColumnTypesMatch(dataSource);
            await assertEntityIdColumnsReady(dataSource);
            await dataSource.synchronize();
        }
    } catch (e) {
        if (dataSource.isInitialized) {
            await dataSource.destroy().catch(() => {
                /* the original error is more useful */
            });
        }
        throw e;
    }
    return dataSource;
}

/**
 * @description
 * A channel assignment entity (see `ChannelAssignment`) maps the same table as the junction
 * metadata of its entity's `channels` many-to-many relation. Two things are aligned so that schema
 * synchronization and migration generation treat the table as unchanged:
 *
 * - The key columns get the exact definition TypeORM gives the junction columns. TypeORM derives
 *   those from the referenced primary keys with driver-specific rules (e.g. `varchar(36)` for UUID
 *   keys on MySQL and MariaDB without a native uuid type), which a declared column cannot know.
 * - The table name is pointed at the assignment entity. TypeORM keys junction metadata by its
 *   table name, so its schema loading (e.g. to tell whether a column has the default length) would
 *   otherwise find the junction, which lacks the per-channel columns. On MySQL/MariaDB that made
 *   schema sync drop and re-add every `varchar` per-channel column. Both describe the same table
 *   and key columns, and TypeORM's many-to-many code uses `relation.junctionEntityMetadata`
 *   directly.
 */
export function alignChannelAssignmentMetadata(dataSource: DataSource) {
    const metadatasMap: Map<unknown, EntityMetadata> | undefined = (dataSource as any).entityMetadatasMap;
    for (const [target, options] of getChannelAssignmentEntities()) {
        if (!dataSource.hasMetadata(target) || !dataSource.hasMetadata(options.entity())) {
            continue;
        }
        const assignment = dataSource.getMetadata(target);
        const junction = dataSource
            .getMetadata(options.entity())
            .findRelationWithPropertyPath('channels')?.junctionEntityMetadata;
        if (!junction || junction.tableName !== assignment.tableName) {
            // Reported by validateChannelAssignmentMetadata() on bootstrap
            continue;
        }
        for (const junctionColumn of junction.columns) {
            const column = assignment.findColumnWithDatabaseName(junctionColumn.databaseName);
            if (column) {
                column.type = junctionColumn.type;
                column.length = junctionColumn.length;
                column.unsigned = junctionColumn.unsigned;
                column.charset = junctionColumn.charset;
                column.collation = junctionColumn.collation;
            }
        }
        metadatasMap?.set(junction.target, assignment);
    }
}

/**
 * MySQL and MariaDB fill `createdAt`/`updatedAt` with `CURRENT_TIMESTAMP` in the session
 * `time_zone`, while the driver writes all other dates in the TypeORM `timezone` option (Vendure
 * default `'Z'`). When the server `time_zone` is not UTC, the two disagree (#1375). So when the
 * driver writes UTC, every new pooled connection sets its session `time_zone` to UTC too.
 *
 * Exported for testing.
 */
export function pinMysqlSessionTimezone(dataSource: DataSource) {
    if (!isMysqlDatabase(dataSource.options.type)) {
        return;
    }
    if (!isUtcTimezone(getDriverTimezone(dataSource.options))) {
        return;
    }
    const driver = dataSource.driver as any;
    const mysql = driver.mysql;
    // The aurora-mysql driver uses the RDS Data API and has no connection pool to hook into.
    // checkDatabaseTimezone() warns when its session time_zone is not UTC.
    if (!mysql || typeof mysql.createPool !== 'function') {
        return;
    }
    const onConnection = (connection: any) =>
        connection.query("SET time_zone = '+00:00'", (error?: Error) => {
            if (error) {
                Logger.error(
                    `Could not set the MySQL session time_zone to UTC: ${error.message}. createdAt and ` +
                        'updatedAt of rows written on this connection follow the server time_zone.',
                    'TypeORM',
                );
            }
        });
    driver.mysql = Object.assign(Object.create(mysql), {
        createPool: (...args: any[]) => {
            const pool = mysql.createPool(...args);
            pool.on('connection', onConnection);
            return pool;
        },
        // With `replication`, the cluster creates one pool per node in `add()`, and the cluster
        // itself emits no 'connection' event.
        createPoolCluster: (...args: any[]) => {
            const cluster = mysql.createPoolCluster(...args);
            const add = cluster.add.bind(cluster);
            cluster.add = (...addArgs: any[]) => {
                const before = new Set(Object.keys(cluster._nodes ?? {}));
                const result = add(...addArgs);
                for (const [id, node] of Object.entries<any>(cluster._nodes ?? {})) {
                    if (!before.has(id)) {
                        node.pool?.on?.('connection', onConnection);
                    }
                }
                return result;
            };
            return cluster;
        },
    });
}

/**
 * Refuse to synchronize a v3 database until the v4 entity id migration has run: synchronizing would
 * drop and re-create the id columns whose type changes under the UUID strategy, and could not add
 * the new foreign keys while rows refer to deleted rows. See prepareEntityIdForeignKeys().
 */
async function assertEntityIdColumnsReady(dataSource: DataSource) {
    const queryRunner = dataSource.createQueryRunner();
    try {
        await assertEntityIdColumnsMigrated(queryRunner);
    } finally {
        await queryRunner.release();
    }
}

/**
 * TypeORM changes a column between `timestamp` and `timestamptz` by dropping and re-adding it, which
 * deletes the stored dates. Refuse to synchronize while any date column's type differs from the
 * entity metadata, e.g. on the first v4 start against a v3 database. The upgrade converts them with
 * a migration (see the v4 "Date and time columns" guide).
 */
async function assertDateColumnTypesMatch(dataSource: DataSource) {
    if (!isPostgresDatabase(dataSource.options.type)) {
        return;
    }
    const queryRunner = dataSource.createQueryRunner();
    try {
        const mismatched = [
            ...(await findTimestampColumnsToMigrate(queryRunner)),
            ...(await findTimestamptzColumnsDeclaredAsTimestamp(queryRunner)),
        ];
        if (mismatched.length) {
            const { table, column } = mismatched[0];
            throw new Error(
                `The database type of ${mismatched.length} date columns (e.g. "${table}"."${column}") differs ` +
                    'from entityOptions.timestampColumnType. Synchronizing would drop and re-create them, ' +
                    'which deletes their data. Set synchronize to false and run a migration which calls ' +
                    'migrateTimestampColumnsToTimestamptz() (or revertTimestamptzMigration()). See the ' +
                    'v4 "Date and time columns" migration guide.',
            );
        }
    } finally {
        await queryRunner.release();
    }
}
