import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('typeorm/find-options/FindOptionsUtils', () => ({
    FindOptionsUtils: {
        // The real implementation eagerly joins relations based on entity metadata, which
        // requires a fully-initialized TypeORM connection. That's out of scope for this unit
        // test, which is only concerned with the batching/ordering logic in this service, so
        // it is stubbed out as a no-op here.
        joinEagerRelations: (qb: any) => qb,
    },
}));

import { RequestContext } from './request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { CustomFieldRelationResolverService } from './custom-field-relation-resolver.service';

/**
 * A minimal stand-in for a TypeORM SelectQueryBuilder, just deep enough to satisfy
 * the chain of calls made in CustomFieldRelationResolverService.
 */
function createQueryBuilderStub(result: { raw?: any[]; many?: any[] }) {
    const qb: any = {
        alias: 'stub',
        expressionMap: { mainAlias: { metadata: {} } },
        leftJoin: () => qb,
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        getRawMany: async () => result.raw ?? [],
        getMany: async () => result.many ?? [],
    };
    return qb;
}

describe('CustomFieldRelationResolverService', () => {
    let getRepository: ReturnType<typeof vi.fn>;
    let connection: any;
    let service: CustomFieldRelationResolverService;
    let fieldDef: any;

    // parentId -> relationIds, used by the fake "mapping" query builder
    let mapping: Record<string, Array<string | number>>;
    // relationId -> fake related entity, used by the fake "relation" query builder
    let relationEntities: Record<string, any>;

    beforeEach(() => {
        mapping = {};
        relationEntities = {};

        getRepository = vi.fn((ctx: RequestContext, target: any) => ({
            createQueryBuilder: (alias: string) => {
                if (alias === 'entity') {
                    type RawRow = { entity_id: string; relation_id: string | number | null };
                    const raw: RawRow[] = Object.entries(mapping).flatMap(
                        ([entityId, relationIds]): RawRow[] =>
                            relationIds.length
                                ? relationIds.map(relationId => ({ entity_id: entityId, relation_id: relationId }))
                                : [{ entity_id: entityId, relation_id: null }],
                    );
                    return createQueryBuilderStub({ raw });
                }
                // 'relation' alias: return the requested related entities
                return createQueryBuilderStub({ many: Object.values(relationEntities) });
            },
        }));

        connection = { getRepository };

        service = new CustomFieldRelationResolverService(
            connection,
            new RequestContextCacheService(),
            { applyChannelPriceAndTax: async (v: any) => v } as any,
            { translate: (v: any) => v } as any,
        );

        fieldDef = { name: 'related', entity: {}, list: false };
    });

    it('batches multiple loads for the same ctx/entity/field into a single pair of queries', async () => {
        mapping = { '1': ['a'], '2': ['b'], '3': ['c'] };
        relationEntities = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } };
        fieldDef.list = false;

        const ctx = RequestContext.empty();

        // Fire off 3 concurrent resolutions for the same entity/field, as would happen when
        // resolving a relation custom field across a list of results in the same tick.
        const [r1, r2, r3] = await Promise.all([
            service.resolveRelation({ ctx, entityId: '1', entityName: 'Product', fieldDef }),
            service.resolveRelation({ ctx, entityId: '2', entityName: 'Product', fieldDef }),
            service.resolveRelation({ ctx, entityId: '3', entityName: 'Product', fieldDef }),
        ]);

        // One call to fetch the repository for the mapping query, one for the relation query -
        // regardless of how many parent ids were resolved.
        expect(getRepository).toHaveBeenCalledTimes(2);

        expect(r1).toEqual({ id: 'a' });
        expect(r2).toEqual({ id: 'b' });
        expect(r3).toEqual({ id: 'c' });
    });

    it('preserves per-entity result ordering, not the order relations were returned in', async () => {
        mapping = { '1': ['c'], '2': ['a'], '3': ['b'] };
        relationEntities = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } };
        fieldDef.list = false;

        const ctx = RequestContext.empty();
        const [r1, r2, r3] = await Promise.all([
            service.resolveRelation({ ctx, entityId: '1', entityName: 'Product', fieldDef }),
            service.resolveRelation({ ctx, entityId: '2', entityName: 'Product', fieldDef }),
            service.resolveRelation({ ctx, entityId: '3', entityName: 'Product', fieldDef }),
        ]);

        expect(r1).toEqual({ id: 'c' });
        expect(r2).toEqual({ id: 'a' });
        expect(r3).toEqual({ id: 'b' });
    });

    it('returns a hydrated array for list fields, in the order relations were mapped', async () => {
        mapping = { '1': ['a', 'b'] };
        relationEntities = { a: { id: 'a' }, b: { id: 'b' } };
        fieldDef.list = true;

        const ctx = RequestContext.empty();
        const result = await service.resolveRelation({ ctx, entityId: '1', entityName: 'Product', fieldDef });

        expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('returns null for a single relation with no mapped relation id', async () => {
        mapping = { '1': [] };
        fieldDef.list = false;

        const ctx = RequestContext.empty();
        const result = await service.resolveRelation({ ctx, entityId: '1', entityName: 'Product', fieldDef });

        expect(result).toBeNull();
    });

    it('returns an empty array for a list relation with no mapped relation ids', async () => {
        mapping = { '1': [] };
        fieldDef.list = true;

        const ctx = RequestContext.empty();
        const result = await service.resolveRelation({ ctx, entityId: '1', entityName: 'Product', fieldDef });

        expect(result).toEqual([]);
    });

    it('does not drop matches when raw ids and hydrated entity ids differ in type', async () => {
        // Simulates a driver (e.g. postgres integer PKs) returning numeric raw ids from
        // getRawMany(), while entityId/hydrated entity ids are strings.
        mapping = { '1': [42] };
        relationEntities = { '42': { id: 42 } };
        fieldDef.list = false;

        const ctx = RequestContext.empty();
        const result = await service.resolveRelation({ ctx, entityId: '1', entityName: 'Product', fieldDef });

        expect(result).toEqual({ id: 42 });
    });

    it('gives a transactional (distinct) RequestContext its own, unbatched loader', async () => {
        mapping = { '1': ['a'] };
        relationEntities = { a: { id: 'a' } };
        fieldDef.list = false;

        const ctx1 = RequestContext.empty();
        const ctx2 = RequestContext.empty();

        await service.resolveRelation({ ctx: ctx1, entityId: '1', entityName: 'Product', fieldDef });
        await service.resolveRelation({ ctx: ctx2, entityId: '1', entityName: 'Product', fieldDef });

        // Each distinct ctx instance triggers its own mapping + relation query pair.
        expect(getRepository).toHaveBeenCalledTimes(4);
    });
});