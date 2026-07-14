import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';
import { FindOptionsUtils } from 'typeorm/find-options/FindOptionsUtils';

import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Translatable } from '../../common/types/locale-types';
import { RelationCustomFieldConfig } from '../../config/custom-field/custom-field-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { VendureEntity } from '../../entity/base/base.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ProductPriceApplicator } from '../../service/helpers/product-price-applicator/product-price-applicator';
import { TranslatorService } from '../../service/helpers/translator/translator.service';

import { RequestContext } from './request-context';

export interface ResolveRelationConfig {
    ctx: RequestContext;
    entityId: ID;
    entityName: string;
    fieldDef: RelationCustomFieldConfig;
}

@Injectable()
export class CustomFieldRelationResolverService {
    constructor(
        private connection: TransactionalConnection,
        private requestCache: RequestContextCacheService,
        private productPriceApplicator: ProductPriceApplicator,
        private translator: TranslatorService,
    ) {}

    /**
     * @description
     * Resolves a relation-type custom field. Lookups for the same entity/field combination
     * within a single request are batched via a DataLoader into one query for the mapping
     * and one for the related entities, eliminating the N+1 pattern that otherwise occurs
     * when resolving list queries.
     */
    async resolveRelation(config: ResolveRelationConfig): Promise<VendureEntity | VendureEntity[] | null> {
        const { ctx, entityId, entityName, fieldDef } = config;

        const loader = this.getLoader(ctx, entityName, fieldDef);
        const batchResult = await loader.load(entityId);
        const finalResult = fieldDef.list ? batchResult : (batchResult[0] ?? null);

        return this.translateEntity(ctx, finalResult, fieldDef);
    }

    /**
     * Returns the DataLoader for a given entity/field combination, creating it if needed.
     *
     * The loader is cached via RequestContextCacheService, which keys on the RequestContext
     * instance itself (a WeakMap), so:
     * - loaders never leak beyond the request they were created for and are garbage-collected
     *   once the request completes;
     * - a transactional RequestContext (a distinct instance from its parent) gets its own,
     *   unbatched loader, so writes made earlier in the same transaction are never masked by a
     *   stale batched read.
     *
     * The loader also memoizes per id for the lifetime of `ctx`. This is safe here because
     * relation custom fields are only ever read via this path within a request, so there is no
     * same-request write that could go stale.
     */
    private getLoader(
        ctx: RequestContext,
        entityName: string,
        fieldDef: RelationCustomFieldConfig,
    ): DataLoader<ID, VendureEntity[]> {
        const cacheKey = `CustomFieldRelationLoader:${entityName}:${fieldDef.name}`;
        return this.requestCache.get(ctx, cacheKey, () =>
            new DataLoader<ID, VendureEntity[]>(ids => this.batchLoad(ctx, entityName, fieldDef, ids as ID[])),
        );
    }

    private async batchLoad(
        ctx: RequestContext,
        entityName: string,
        fieldDef: RelationCustomFieldConfig,
        ids: ID[],
    ): Promise<VendureEntity[][]> {
        // Fetch the parent -> relation id mapping for all batched parent ids in a single query
        const mappingQb = this.connection
            .getRepository(ctx, entityName)
            .createQueryBuilder('entity')
            .leftJoin(`entity.customFields.${fieldDef.name}`, 'relationEntity')
            .select('entity.id', 'entity_id')
            .addSelect('relationEntity.id', 'relation_id')
            .where('entity.id IN (:...ids)', { ids });

        const rawMappings = await mappingQb.getRawMany();

        // Normalize ids to strings before using them as Map keys. getRawMany() returns
        // driver-native raw values (which may be numbers, e.g. on postgres integer PKs),
        // while `ids` (from DataLoader) and hydrated entity `.id` values are not guaranteed
        // to be of the same type. Without normalizing, lookups below can silently miss.
        const mappingMap = new Map<string, ID[]>();
        for (const row of rawMappings) {
            const relationId: ID | undefined = row.relation_id;
            if (relationId == null) {
                continue;
            }
            const parentKey = String(row.entity_id);
            const existing = mappingMap.get(parentKey);
            if (existing) {
                existing.push(relationId);
            } else {
                mappingMap.set(parentKey, [relationId]);
            }
        }

        const allRelationIds = Array.from(
            new Set(rawMappings.map(row => row.relation_id).filter((id): id is ID => id != null)),
        );

        let relations: VendureEntity[] = [];
        if (allRelationIds.length > 0) {
            const relationQb = this.connection
                .getRepository(ctx, fieldDef.entity)
                .createQueryBuilder('relation')
                .where('relation.id IN (:...allRelationIds)', { allRelationIds });

            FindOptionsUtils.joinEagerRelations(
                relationQb,
                relationQb.alias,
                relationQb.expressionMap.mainAlias!.metadata,
            );
            relations = await relationQb.getMany();
        }

        const relationMap = new Map<string, VendureEntity>();
        for (const rel of relations) {
            relationMap.set(String(rel.id), rel);
        }

        // Map grouped relation ids back to each original id, in the same order DataLoader
        // requested them, so results line up with their corresponding parent entity.
        return ids.map(id => {
            const targetIds = mappingMap.get(String(id)) ?? [];
            return targetIds
                .map(targetId => relationMap.get(String(targetId)))
                .filter((r): r is VendureEntity => r != null);
        });
    }

    async translateEntity(
        ctx: RequestContext,
        result: VendureEntity | VendureEntity[] | null,
        fieldDef: RelationCustomFieldConfig,
    ) {
        if (result == null) return null;

        if (fieldDef.entity === ProductVariant) {
            if (Array.isArray(result)) {
                await Promise.all(result.map(r => this.applyVariantPrices(ctx, r as any)));
            } else {
                await this.applyVariantPrices(ctx, result as any);
            }
        }

        const translated: any = Array.isArray(result)
            ? result.map(r => (this.isTranslatable(r) ? this.translator.translate(r, ctx) : r))
            : this.isTranslatable(result)
              ? this.translator.translate(result, ctx)
              : result;

        return translated;
    }

    private isTranslatable(input: unknown): input is Translatable {
        return typeof input === 'object' && input != null && input.hasOwnProperty('translations');
    }

    private async applyVariantPrices(ctx: RequestContext, variant: ProductVariant): Promise<ProductVariant> {
        const taxCategory = await this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder()
            .relation('taxCategory')
            .of(variant)
            .loadOne();
        variant.taxCategory = taxCategory;
        return this.productPriceApplicator.applyChannelPriceAndTax(variant, ctx);
    }
}