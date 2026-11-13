import { getMetadataArgsStorage } from 'typeorm';
import { ColumnMetadataArgs } from 'typeorm/metadata-args/ColumnMetadataArgs';

import { VendureConfig } from '../config/vendure-config';
import { getDatabaseType } from '../connection/database-type';

/**
 * The column type each column had when it was first seen, so that the function can run several
 * times in one process (e.g. e2e tests bootstrapping servers with different configs).
 */
const originalTypes = new WeakMap<ColumnMetadataArgs, ColumnMetadataArgs['options']['type']>();

const DATE_MODES = new Set(['createDate', 'updateDate', 'deleteDate']);

/**
 * @description
 * On Postgres, sets the column type of every date-time column of the given entities to
 * `EntityOptions.timestampColumnType` (default `timestamptz`). A column is a date-time column if it is
 * a `@CreateDateColumn()`, `@UpdateDateColumn()` or `@DeleteDateColumn()` without an explicit type, or
 * if its type is `Date` (either `type: Date` or inferred from the TypeScript type via
 * reflect-metadata). Columns with an explicit string type (e.g. `type: 'timestamp'`) are left alone.
 *
 * Works on the TypeORM metadata args, so it must run before the DataSource is created. Entities
 * inherit columns from their parent classes (e.g. `VendureEntity.createdAt`), so the parents of the
 * given entities are included.
 */
export function setTimestampColumnTypes(config: VendureConfig, entities: Array<Function | string | any>) {
    const dbType = getDatabaseType(config.dbConnectionOptions);
    if (dbType !== 'postgres') {
        return;
    }
    const targetType = config.entityOptions?.timestampColumnType ?? 'timestamptz';
    const targets = new Set<Function>();
    for (const entity of entities) {
        if (typeof entity !== 'function') {
            continue;
        }
        let proto = entity;
        while (proto && proto !== Function.prototype) {
            targets.add(proto);
            proto = Object.getPrototypeOf(proto);
        }
    }
    // Embedded classes (e.g. the custom fields of an entity) hold columns too
    const storage = getMetadataArgsStorage();
    let added = true;
    while (added) {
        added = false;
        for (const embedded of storage.embeddeds) {
            if (typeof embedded.target === 'function' && targets.has(embedded.target)) {
                const type = embedded.type();
                if (typeof type === 'function' && !targets.has(type)) {
                    targets.add(type);
                    added = true;
                }
            }
        }
    }
    for (const column of storage.columns) {
        if (typeof column.target !== 'function' || !targets.has(column.target)) {
            continue;
        }
        if (!originalTypes.has(column)) {
            originalTypes.set(column, column.options.type);
        }
        const original = originalTypes.get(column);
        const isDateColumn = original === Date || (original === undefined && DATE_MODES.has(column.mode));
        if (!isDateColumn) {
            continue;
        }
        column.options.type = targetType === 'timestamptz' ? 'timestamptz' : original;
    }
}
