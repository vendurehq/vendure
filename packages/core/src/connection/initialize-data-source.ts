import { DataSource, DataSourceOptions, EntityMetadata } from 'typeorm';

/**
 * @description
 * Creates and initializes a TypeORM DataSource, like `new DataSource(options).initialize()`, but
 * runs schema synchronization (and `migrationsRun`) only after {@link preferChannelAssignmentMetadata}
 * has been applied, so that synchronization sees the channel assignment entities correctly.
 */
export async function initializeDataSource(options: DataSourceOptions): Promise<DataSource> {
    const dataSource = new DataSource({ ...options, synchronize: false, migrationsRun: false });
    await dataSource.initialize();
    preferChannelAssignmentMetadata(dataSource);
    // Restore the configured values, which other code reads from the DataSource
    Object.assign(dataSource.options, {
        synchronize: options.synchronize,
        migrationsRun: options.migrationsRun,
    });
    if (options.synchronize) {
        await dataSource.synchronize();
    }
    if (options.migrationsRun) {
        await dataSource.runMigrations({ transaction: options.migrationsTransactionMode });
    }
    return dataSource;
}

/**
 * @description
 * A channel assignment entity (see `ChannelAssignment`) shares its table with the junction metadata
 * of the `channels` many-to-many relation. TypeORM keys junction metadata by the table name, so
 * looking up metadata by table name, as its schema loading does (e.g. to tell whether a column's
 * length is the database default), finds the junction, which lacks the per-channel columns. On
 * MySQL/MariaDB this made schema sync drop and re-add every `varchar` per-channel column.
 *
 * This points the table name at the assignment entity instead. Both describe the same table and key
 * columns, and TypeORM's many-to-many code uses `relation.junctionEntityMetadata` directly.
 */
export function preferChannelAssignmentMetadata(dataSource: DataSource) {
    const metadatasMap: Map<unknown, EntityMetadata> | undefined = (dataSource as any).entityMetadatasMap;
    if (!metadatasMap) {
        return;
    }
    for (const junction of dataSource.entityMetadatas) {
        if (junction.tableType !== 'junction' || junction.synchronize !== false) {
            continue;
        }
        const assignment = dataSource.entityMetadatas.find(
            m => m.tableName === junction.tableName && m.tableType !== 'junction',
        );
        if (assignment) {
            metadatasMap.set(junction.target, assignment);
        }
    }
}
