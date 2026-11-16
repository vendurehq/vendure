import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';
import { SelectQueryBuilder } from 'typeorm';
import { FindOptionsUtils } from 'typeorm/find-options/FindOptionsUtils';

import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Translatable } from '../../common/types/locale-types';
import {
    isChannelScopedCustomField,
    RelationCustomFieldConfig,
} from '../../config/custom-field/custom-field-types';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { VendureEntity } from '../../entity/base/base.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ChannelAssignmentService } from '../../service/helpers/channel-assignment/channel-assignment.service';
import { ChannelEnabledChecker } from '../../service/helpers/channel-enabled-checker/channel-enabled-checker';
import {
    getRelationTargetScope,
    isScopedRelationTarget,
} from '../../service/helpers/custom-field-relation/relation-target-scope';
import { ProductPriceApplicator } from '../../service/helpers/product-price-applicator/product-price-applicator';
import { TranslatorService } from '../../service/helpers/translator/translator.service';

import { RequestContext } from './request-context';

export interface ResolveRelationConfig {
    ctx: RequestContext;
    entityId: ID | undefined;
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
        private channelEnabledChecker: ChannelEnabledChecker,
        private channelAssignmentService: ChannelAssignmentService,
    ) {}

    /**
     * @description
     * Filters a value of the field which was loaded together with the owning entity (an `eager`
     * relation, or one the query joined), down to the related entities the caller may see. The
     * load that produced it applied no Channel, soft-deletion or `enabled` filter. Returns the
     * value unchanged if the target entity has no such scope.
     *
     * Checking visibility costs one id-only query per target entity type per request, batched
     * across fields and rows, and the pre-loaded entities are reused.
     */
    async filterPreloadedValue(
        ctx: RequestContext,
        fieldDef: RelationCustomFieldConfig,
        value: VendureEntity | VendureEntity[],
    ): Promise<VendureEntity | VendureEntity[] | null> {
        if (!isScopedRelationTarget(getRelationTargetScope(this.connection.rawConnection, fieldDef.entity))) {
            return value;
        }
        const loader = this.requestCache.get(
            ctx,
            `CustomFieldRelationVisibility:${fieldDef.entity.name}`,
            () =>
                new DataLoader<string, boolean>(async ids => {
                    const qb = this.connection
                        .getRepository(ctx, fieldDef.entity)
                        .createQueryBuilder('relation')
                        .select('relation.id')
                        .where('relation.id IN (:...ids)', { ids });
                    this.applyTargetScope(ctx, qb, fieldDef);
                    const visible = new Set((await qb.getMany()).map(e => String(e.id)));
                    return ids.map(id => visible.has(id));
                }),
        );
        if (Array.isArray(value)) {
            const visible = await loader.loadMany(value.map(e => String(e.id)));
            return value.filter((_, i) => visible[i] === true);
        }
        return (await loader.load(String(value.id))) ? value : null;
    }

    /**
     * @description
     * Resolves a relation-type custom field. Lookups for the same entity/field combination
     * within a single request are batched via a DataLoader into one query for the mapping
     * and one for the related entities, eliminating the N+1 pattern that otherwise occurs
     * when resolving list queries.
     */
    async resolveRelation(config: ResolveRelationConfig): Promise<VendureEntity | VendureEntity[] | null> {
        const { ctx, entityId, entityName, fieldDef } = config;

        // Embedded value objects such as OrderAddress (Order.shippingAddress / billingAddress) have
        // no `id`, so `entityId` can be undefined. Passing it to DataLoader.load() would throw
        // ("The loader.load() function must be called with a value, but got: undefined"); there is
        // nothing to resolve by id, so return an empty result, matching the behaviour before
        // relation custom fields were resolved via DataLoader.
        if (entityId == null) {
            return fieldDef.list ? [] : null;
        }

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
        return this.requestCache.get(
            ctx,
            cacheKey,
            () =>
                new DataLoader<ID, VendureEntity[]>(ids =>
                    this.batchLoad(ctx, entityName, fieldDef, ids as ID[]),
                ),
        );
    }

    private async batchLoad(
        ctx: RequestContext,
        entityName: string,
        fieldDef: RelationCustomFieldConfig,
        ids: ID[],
    ): Promise<VendureEntity[][]> {
        // Fetch the parent -> relation id mapping for all batched parent ids in a single query.
        // Channel-scoped fields live on the entity's channel assignment row for the active Channel.
        const assignment = isChannelScopedCustomField(fieldDef)
            ? this.channelAssignmentService.getMetadataByEntityName(entityName)
            : undefined;
        // Only the queried table, its id column and the Channel condition differ
        const idColumn = assignment ? `entity.${assignment.entityIdProperty}` : 'entity.id';
        const mappingQb = this.connection
            .getRepository(ctx, assignment ? assignment.target : entityName)
            .createQueryBuilder('entity')
            .leftJoin(`entity.customFields.${fieldDef.name}`, 'relationEntity')
            .select(idColumn, 'entity_id')
            .addSelect('relationEntity.id', 'relation_id')
            .where(`${idColumn} IN (:...ids)`, { ids });
        if (assignment) {
            mappingQb.andWhere('entity.channelId = :channelId', { channelId: ctx.channelId });
        }

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
            this.applyTargetScope(ctx, relationQb, fieldDef);

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

    /**
     * Limits the related entities to those the caller may see: entities assigned to the active
     * Channel if the target is ChannelAware, and in the Shop API, entities which are not
     * soft-deleted and, for Products and ProductVariants, enabled in the active Channel.
     */
    private applyTargetScope(
        ctx: RequestContext,
        qb: SelectQueryBuilder<any>,
        fieldDef: RelationCustomFieldConfig,
    ) {
        const scope = getRelationTargetScope(this.connection.rawConnection, fieldDef.entity);
        const isShop = ctx.apiType === 'shop';
        if (isShop && scope.channelEnabled) {
            // Also restricts the query to entities assigned to the active Channel.
            this.channelEnabledChecker.applyToQuery(ctx, qb, fieldDef.entity as any, qb.alias);
        } else if (scope.channelAware) {
            qb.innerJoin(
                `${qb.alias}.channels`,
                'relation_channel',
                'relation_channel.id = :relationChannelId',
                {
                    relationChannelId: ctx.channelId,
                },
            );
        }
        if (isShop && scope.softDeletable) {
            qb.andWhere(`${qb.alias}.deletedAt IS NULL`);
        }
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
