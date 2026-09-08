import { FindOptionsUtils } from 'typeorm/find-options/FindOptionsUtils';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { SelectQueryBuilder } from 'typeorm/query-builder/SelectQueryBuilder';

let patchApplied = false;

/**
 * Keeps eager relations joined into the main query under `relationLoadStrategy: 'query'`.
 *
 * TypeORM v0.3 joins the queried entity's eager relations whatever the relation load strategy
 * is. The strategy governs only the relations named in `relations`. TypeORM v1 extends the
 * strategy to eager relations as well, so under `'query'` each eager relation is loaded by two
 * further queries: one for the relation ids, one for the entities.
 *
 * Vendure sets `relationLoadStrategy: 'query'` on its main read paths, and every translatable
 * entity declares `translations` as an eager relation. On v1 those relations cost two queries
 * each, where v0.3 joins them into a query that is running anyway. Measured on the shop API with
 * the query set of the Next.js starter, v1 issued 18% more SQL statements per request and raised
 * median latency by a comparable amount, for a response that is byte for byte the same.
 *
 * This patch restores the v0.3 arrangement. Once the find options are applied, an eager relation
 * queued for its own queries is joined into the main query and dropped from that queue, unless
 * the caller named it in `relations`. A named relation is left alone, so an explicit request
 * loads by whichever strategy was asked for.
 *
 * On a TypeORM version that already joins eager relations there is nothing queued to move, so
 * this patch does nothing.
 */
export function patchTypeOrmEagerRelationJoins() {
    if (patchApplied) {
        return;
    }
    patchApplied = true;

    const proto = SelectQueryBuilder.prototype as any;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalSetFindOptions = proto.setFindOptions;
    if (typeof originalSetFindOptions !== 'function') {
        // The method this patch hooks has been renamed or removed. Leaving the behaviour alone
        // costs queries; guessing at a replacement risks correctness.
        return;
    }
    // Hooked here rather than on the `applyFindOptions` that `setFindOptions` calls:
    // `setFindOptions` is the public method of the two, and every nested relation load passes
    // through it as well.
    proto.setFindOptions = function (this: any, ...args: any[]) {
        const result = originalSetFindOptions.apply(this, args);
        joinEagerRelationsInsteadOfQuerying(this);
        return result;
    };
}

/**
 * Joins the eager relations of `qb`'s main alias into the query and removes them from the list
 * of relations to load by separate query. A relation the find options name is left in place.
 * Exported for testing.
 */
export function joinEagerRelationsInsteadOfQuerying(qb: any): void {
    if (qb?.expressionMap?.relationLoadStrategy !== 'query') {
        return;
    }
    const mainAlias = qb.expressionMap.mainAlias;
    if (!mainAlias?.hasMetadata || !Array.isArray(qb.relationMetadatas) || !qb.relationMetadatas.length) {
        return;
    }
    const requestedRelations = qb.findOptions?.relations;
    const eagerOnly: RelationMetadata[] = qb.relationMetadatas.filter(
        (relation: RelationMetadata) =>
            relation.isEager &&
            mainAlias.metadata.eagerRelations.includes(relation) &&
            !isNamedInRelations(requestedRelations, relation.propertyPath),
    );
    if (!eagerOnly.length) {
        return;
    }
    // The fourth argument forces left joins, which is what v0.3 does unconditionally. Without it
    // `joinEagerRelations` picks an inner join for a non-nullable relation, dropping rows that a
    // left join returns. v0.3 declares three parameters and ignores a fourth, so the call is cast
    // to keep both versions compiling.
    (
        FindOptionsUtils.joinEagerRelations as unknown as (
            qb: unknown,
            alias: string,
            metadata: unknown,
            parentJoinType: string,
        ) => void
    )(qb, mainAlias.name, mainAlias.metadata, 'left');
    qb.relationMetadatas = qb.relationMetadatas.filter(
        (relation: RelationMetadata) => !eagerOnly.includes(relation),
    );
}

/**
 * Whether the find options name the given relation path, in either of the forms TypeORM accepts:
 * `{ translations: true }` and `{ translations: { ... } }`.
 *
 * A relation declared on an embedded entity has a dotted property path, so an eager relation
 * custom field is `customFields.owner` here and is named as `{ customFields: { owner: true } }`.
 */
function isNamedInRelations(relations: any, propertyPath: string): boolean {
    let value = relations;
    for (const segment of propertyPath.split('.')) {
        if (value == null || typeof value !== 'object') {
            return false;
        }
        value = value[segment];
    }
    return value === true || (value != null && typeof value === 'object');
}
