import { getMetadataArgsStorage } from 'typeorm';
import { ColumnMetadataArgs } from 'typeorm/metadata-args/ColumnMetadataArgs';

import { VendureConfig } from '../config/vendure-config';
import { getDatabaseType } from '../connection/database-type';
import { isPostgresDatabase } from '../connection/timezone-utils';

/**
 * The column type each column had when it was first seen, so that the function can run several
 * times in one process (e.g. e2e tests bootstrapping servers with different configs).
 */
const originalTypes = new Map<ColumnMetadataArgs, ColumnMetadataArgs['options']['type']>();

/**
 * The columns (by declaring class and property) which the last call converted to `timestamptz`.
 */
const convertedColumns = new WeakMap<Function, Set<string>>();

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
 * given entities are included, and so are embedded classes such as custom fields.
 *
 * On other databases, any change made by an earlier call in the same process is undone.
 */
export function setTimestampColumnTypes(config: VendureConfig, entities: Array<Function | string | any>) {
    // Undo the previous call, so that the result only depends on this config
    for (const [column, original] of originalTypes) {
        column.options.type = original;
        if (typeof column.target === 'function') {
            convertedColumns.delete(column.target);
        }
    }
    if (!isPostgresDatabase(getDatabaseType(config.dbConnectionOptions))) {
        return;
    }
    if ((config.entityOptions?.timestampColumnType ?? 'timestamptz') !== 'timestamptz') {
        return;
    }
    const storage = getMetadataArgsStorage();
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
        column.options.type = 'timestamptz';
        const set = convertedColumns.get(column.target) ?? new Set<string>();
        set.add(column.propertyName);
        convertedColumns.set(column.target, set);
    }
}

/**
 * @description
 * Whether {@link setTimestampColumnTypes} converted this column to `timestamptz`, as opposed to a
 * column which was declared `timestamptz` explicitly. Takes the `target` and `propertyName` of
 * the TypeORM `ColumnMetadata`, which are those of the declaring class.
 */
export function isConvertedTimestampColumn(target: Function | string, propertyName: string): boolean {
    return typeof target === 'function' && (convertedColumns.get(target)?.has(propertyName) ?? false);
}
