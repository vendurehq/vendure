import { FindOptionsUtils } from 'typeorm/find-options/FindOptionsUtils';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { SelectQueryBuilder } from 'typeorm/query-builder/SelectQueryBuilder';

let patchApplied = false;

/**
 * Keeps eager relations joined into the main query under `relationLoadStrategy: 'query'`,
 * rather than fetched by a separate query each.
 *
 * TypeORM v0.3 joins the queried entity's eager relations whatever the relation load strategy
 * is; the strategy governs only the relations named in `relations`. TypeORM v1 changed that, so
 * that under the `'query'` strategy each eager relation is fetched by its own pair of queries —
 * one to load the relation ids and one to load the entities — instead of being joined.
 *
 * Vendure sets `relationLoadStrategy: 'query'` on its main read paths, and every translatable
 * entity declares `translations` as an eager relation, so the change turns a join that came for
 * free into two round trips per eager relation per query. Measured on the shop API with the
 * query set of the Next.js starter, it added 18% to the statements issued per request and moved
 * median latency by a comparable amount, for a response that is byte for byte the same.
 *
 * The patch restores the v0.3 arrangement: after the find options have been applied, any eager
 * relation that is queued for a separate query *only because it is eager* is joined into the
 * main query instead and dropped from that queue. Relations the caller named in `relations` are
 * left alone, so an explicit request still loads by whichever strategy was asked for.
 *
 * On a TypeORM version that already joins eager relations there is nothing queued to move, so
 * the patch does nothing.
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
    // `setFindOptions` rather than the `applyFindOptions` it calls, because it is the public
    // method of the two and is where every nested relation load enters as well.
    proto.setFindOptions = function (this: any, ...args: any[]) {
        const result = originalSetFindOptions.apply(this, args);
        joinEagerRelationsInsteadOfQuerying(this);
        return result;
    };
}

/**
 * Moves the eager-only relations of `qb`'s main alias out of the separate-query queue and into
 * the query as joins. Exported for testing.
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
    // The fourth argument forces left joins, matching what v0.3 did unconditionally. Without it
    // v1's helper picks an inner join for a non-nullable relation, which can drop rows the
    // previous behaviour returned. v0.3's signature has no fourth parameter and ignores it, so
    // the call is cast rather than overloaded.
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
 * Whether the find options name the given relation path, by any of the forms TypeORM accepts —
 * `{ translations: true }`, `{ translations: { ... } }` or a nested path such as
 * `{ variants: { translations: true } }`.
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
