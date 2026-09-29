import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';
import { describe, expect, it, vi } from 'vitest';

import { joinEagerRelationsInsteadOfQuerying } from './typeorm-eager-relation-join-fix';

const joinEagerRelations = vi.hoisted(() => vi.fn());
vi.mock('typeorm/find-options/FindOptionsUtils', () => ({
    FindOptionsUtils: { joinEagerRelations },
}));

describe('joinEagerRelationsInsteadOfQuerying()', () => {
    function relation(propertyPath: string, isEager = true): RelationMetadata {
        return { propertyPath, isEager } as RelationMetadata;
    }

    function queryBuilder(options: {
        relationLoadStrategy?: string;
        eagerRelations?: RelationMetadata[];
        relationMetadatas?: RelationMetadata[];
        relations?: any;
        hasMetadata?: boolean;
    }) {
        const eagerRelations = options.eagerRelations ?? [];
        return {
            expressionMap: {
                relationLoadStrategy: options.relationLoadStrategy ?? 'query',
                mainAlias: {
                    name: 'product',
                    hasMetadata: options.hasMetadata ?? true,
                    metadata: { eagerRelations },
                },
            },
            relationMetadatas: options.relationMetadatas ?? [...eagerRelations],
            findOptions: { relations: options.relations },
        };
    }

    it('joins an eager relation and drops it from the separate-query queue', () => {
        joinEagerRelations.mockClear();
        const translations = relation('translations');
        const qb = queryBuilder({ eagerRelations: [translations] });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).toHaveBeenCalledTimes(1);
        expect(joinEagerRelations).toHaveBeenCalledWith(
            qb,
            'product',
            qb.expressionMap.mainAlias.metadata,
            'left',
        );
        expect(qb.relationMetadatas).toEqual([]);
    });

    it('leaves relations which are not eager alone', () => {
        joinEagerRelations.mockClear();
        const variants = relation('variants', false);
        const qb = queryBuilder({ eagerRelations: [], relationMetadatas: [variants] });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).not.toHaveBeenCalled();
        expect(qb.relationMetadatas).toEqual([variants]);
    });

    it('leaves an eager relation alone when the caller named it in relations', () => {
        joinEagerRelations.mockClear();
        const translations = relation('translations');
        const qb = queryBuilder({ eagerRelations: [translations], relations: { translations: true } });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).not.toHaveBeenCalled();
        expect(qb.relationMetadatas).toEqual([translations]);
    });

    it('recognises a relation named as a nested object', () => {
        joinEagerRelations.mockClear();
        const translations = relation('translations');
        const qb = queryBuilder({
            eagerRelations: [translations],
            relations: { translations: { base: true } },
        });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).not.toHaveBeenCalled();
    });

    it('joins an eager relation custom field, whose path names its embedded entity', () => {
        joinEagerRelations.mockClear();
        const owner = relation('customFields.owner');
        const qb = queryBuilder({ eagerRelations: [owner] });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).toHaveBeenCalledTimes(1);
        expect(qb.relationMetadatas).toEqual([]);
    });

    it('leaves an eager relation custom field alone when the caller named it', () => {
        joinEagerRelations.mockClear();
        const owner = relation('customFields.owner');
        const qb = queryBuilder({
            eagerRelations: [owner],
            relations: { customFields: { owner: true } },
        });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).not.toHaveBeenCalled();
        expect(qb.relationMetadatas).toEqual([owner]);
    });

    it('does nothing under the join strategy, where eager relations are joined already', () => {
        joinEagerRelations.mockClear();
        const qb = queryBuilder({
            relationLoadStrategy: 'join',
            eagerRelations: [relation('translations')],
        });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).not.toHaveBeenCalled();
    });

    it('does nothing when the queue is empty, which is the case on TypeORM v0.3', () => {
        joinEagerRelations.mockClear();
        const qb = queryBuilder({ eagerRelations: [relation('translations')], relationMetadatas: [] });

        joinEagerRelationsInsteadOfQuerying(qb);

        expect(joinEagerRelations).not.toHaveBeenCalled();
    });

    it('tolerates a query builder with no metadata on its main alias', () => {
        joinEagerRelations.mockClear();
        const qb = queryBuilder({ hasMetadata: false, eagerRelations: [relation('translations')] });

        expect(() => joinEagerRelationsInsteadOfQuerying(qb)).not.toThrow();
        expect(joinEagerRelations).not.toHaveBeenCalled();
    });
});
