import { QueryRunner } from 'typeorm';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { JoinAttribute } from 'typeorm/query-builder/JoinAttribute';
import { SelectQueryBuilder } from 'typeorm/query-builder/SelectQueryBuilder';

let patchApplied = false;

/**
 * Options which narrow what a relation load returns. Only the shape this module inspects is
 * declared; the find options carry more than this.
 */
export interface RelationLoadNarrowingOptions {
    select?: any;
    order?: any;
    relations?: any;
}

/**
 * Stops an eager relation from being loaded twice when the query already joins and selects it,
 * under `relationLoadStrategy: 'query'`.
 *
 * Under that strategy each eager relation of the queried entity is fetched by a separate query
 * after the main one, and the result is assigned over whatever the main query hydrated. A query
 * which joins and selects an eager relation itself therefore pays for the relation twice: once
 * in the join and once in the extra query. {@link ListQueryBuilder} does exactly this for the
 * relations that a `@Calculated()` column's expression refers to, because the expression names
 * the join alias and so the join has to exist for the SQL to resolve.
 *
 * The patch drops such a relation from the separate-query list, on the conditions described by
 * {@link joinCoversRelation}.
 *
 * Reported upstream as https://github.com/typeorm/typeorm/issues/12775. This workaround can be
 * removed once the minimum supported TypeORM version contains a fix.
 */
export function patchTypeOrmDuplicateEagerLoad() {
    if (patchApplied) {
        return;
    }
    patchApplied = true;

    const proto = SelectQueryBuilder.prototype as any;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalExecute = proto.executeEntitiesAndRawResults;
    proto.executeEntitiesAndRawResults = function (this: any, queryRunner: QueryRunner) {
        if (this.expressionMap.relationLoadStrategy === 'query' && this.relationMetadatas.length) {
            this.relationMetadatas = this.relationMetadatas.filter(
                (relation: RelationMetadata) =>
                    !joinCoversRelation(
                        relation,
                        this.expressionMap.joinAttributes,
                        this.expressionMap.mainAlias?.name,
                        this.findOptions ?? {},
                    ),
            );
        }
        return originalExecute.call(this, queryRunner);
    };
}

/**
 * Whether one of the given joins already produces exactly what the separate query for `relation`
 * would, so that running the query as well only repeats work.
 *
 * The join has to be a LEFT join of that relation from the queried entity, carry no extra ON
 * condition, and be selected. A join which restricts its rows — as a channel-scoped
 * `INNER JOIN ... ON channel.id = :channelId` does — hydrates a subset of the relation, and the
 * separate query is what replaces that subset with the whole of it, so it is not covered.
 *
 * Beyond that, the separate query loads the related entity's own eager relations and honours any
 * `select`, `order` or `relations` the find options give for the relation, none of which a join
 * of it reproduces. A relation is therefore only covered when neither applies to it.
 */
export function joinCoversRelation(
    relation: RelationMetadata,
    joinAttributes: JoinAttribute[],
    mainAliasName: string | undefined,
    findOptions: RelationLoadNarrowingOptions,
): boolean {
    if (!relation.isEager || relation.inverseEntityMetadata.eagerRelations.length > 0) {
        return false;
    }
    const narrowed = [findOptions.select, findOptions.order, findOptions.relations].some(options =>
        hasOptionsForPath(options, relation.propertyPath),
    );
    if (narrowed) {
        return false;
    }
    return joinAttributes.some(
        join =>
            join.relation === relation &&
            join.parentAlias === mainAliasName &&
            join.direction === 'LEFT' &&
            join.condition === undefined &&
            join.isSelected,
    );
}

/**
 * Whether the given find options object holds a nested object at `propertyPath`, i.e. says
 * something about the contents of the relation rather than merely naming it.
 */
function hasOptionsForPath(options: any, propertyPath: string): boolean {
    let value = options;
    for (const segment of propertyPath.split('.')) {
        if (value == null || typeof value !== 'object') {
            return false;
        }
        value = value[segment];
    }
    return value != null && typeof value === 'object';
}
