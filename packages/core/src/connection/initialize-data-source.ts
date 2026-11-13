import { DataSource, DataSourceOptions, EntityMetadata } from 'typeorm';

import { getChannelAssignmentEntities } from '../entity/channel-assignment/channel-assignment-registry';

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
