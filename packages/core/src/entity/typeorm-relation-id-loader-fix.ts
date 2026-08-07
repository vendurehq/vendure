import { Driver } from 'typeorm';
import { DriverUtils } from 'typeorm/driver/DriverUtils';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { RelationIdLoader } from 'typeorm/query-builder/RelationIdLoader';

let patchApplied = false;

/**
 * Works around a TypeORM bug in the `relationLoadStrategy: 'query'` implementation which causes
 * to-one relations to resolve to `null` when the relation's join column is co-mapped with a real
 * id column (an `@EntityId`/`@Column` property mapping to the same database column as the join
 * column) and the entity/property names are long.
 *
 * `RelationIdLoader.loadManyToManyRelationIdsAndGroup()` matches related entities to their parents
 * by looking up keys of the form `<Entity>_<relationPropertyPath>_<referencedColumnPath>` in the
 * rows returned by `load()`, and passes each key through `DriverUtils.buildAlias()`, which hashes
 * any key longer than the driver's `maxAliasLength` (63 for postgres and mysql). The database-query
 * code paths inside `load()` build their result keys with `DriverUtils.buildAlias()` too, so the
 * lookup always matches. However, `loadForManyToOneAndOneToOneOwner()` and
 * `loadForOneToManyAndOneToOneNotOwner()` each contain an in-memory fast path which builds the keys
 * by plain string concatenation without `buildAlias()`. When such a key exceeds `maxAliasLength`,
 * the consumer hashes it, finds nothing, and the relation is silently set to `null`.
 *
 * The fast path only activates when the join column is a real (non-virtual) column of the entity,
 * which is exactly the arrangement created by co-mapped id columns. Since every relation custom
 * field registers a `<name>Id` id column alongside its relation, any relation custom field whose
 * `<TargetEntity>_customFields_<name>_id` key exceeds 63 characters would hydrate as `null` on
 * postgres and mysql without this patch.
 *
 * The patch normalizes the affected keys in the results of the two fast-path methods, applying the
 * same `DriverUtils.buildAlias()` transformation the consumer uses. Keys within the alias length
 * limit are returned unchanged by `buildAlias()`, so the patch is a no-op for them.
 *
 * Reported upstream as https://github.com/typeorm/typeorm/issues/11227 and fixed by
 * https://github.com/typeorm/typeorm/pull/11228, but that fix shipped only in TypeORM v1.0.0
 * and was not backported to the 0.3.x line which Vendure depends on. If TypeORM is upgraded to
 * a version containing the fix, the fast-path keys are already alias-normalized and this patch
 * becomes a no-op, at which point it can be removed.
 */
export function patchTypeOrmRelationIdLoader() {
    if (patchApplied) {
        return;
    }
    patchApplied = true;

    const proto = RelationIdLoader.prototype as any;
    for (const methodName of [
        'loadForManyToOneAndOneToOneOwner',
        'loadForOneToManyAndOneToOneNotOwner',
    ]) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalMethod = proto[methodName];
        proto[methodName] = async function (relation: RelationMetadata, ...rest: any[]) {
            const rows = await originalMethod.apply(this, [relation, ...rest]);
            return normalizeGroupingKeys(this.connection.driver, relation, rows);
        };
    }
}

/**
 * Renames any over-long grouping keys in the given raw rows to the hashed alias form which
 * `loadManyToManyRelationIdsAndGroup()` uses to look them up.
 */
function normalizeGroupingKeys(driver: Driver, relation: RelationMetadata, rows: any[]): any[] {
    if (!driver.maxAliasLength || !Array.isArray(rows)) {
        return rows;
    }
    // The same columns from which loadManyToManyRelationIdsAndGroup() constructs its lookup keys.
    let columns: ColumnMetadata[] = [];
    if (relation.isManyToOne || relation.isOneToOneOwner) {
        columns = relation.joinColumns
            .map(column => column.referencedColumn)
            .filter((column): column is ColumnMetadata => column != null);
    } else if (relation.isOneToMany || relation.isOneToOneNotOwner) {
        columns = relation.inverseRelation?.entityMetadata.primaryColumns ?? [];
    }
    for (const column of columns) {
        const rawKey =
            column.entityMetadata.name +
            '_' +
            relation.propertyPath.replace('.', '_') +
            '_' +
            column.propertyPath.replace('.', '_');
        if (rawKey.length <= driver.maxAliasLength) {
            continue;
        }
        const aliasKey = DriverUtils.buildAlias(driver, undefined, rawKey);
        for (const row of rows) {
            if (row && rawKey in row) {
                row[aliasKey] = row[rawKey];
                delete row[rawKey];
            }
        }
    }
    return rows;
}
