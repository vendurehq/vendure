import { Injectable } from '@nestjs/common';
import {
    CreateFacetValueInput,
    CreateFacetValueWithFacetInput,
    DeletionResponse,
    DeletionResult,
    LanguageCode,
    UpdateFacetValueInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import DataLoader from 'dataloader';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Product, ProductVariant } from '../../entity';
import { FacetValueTranslation } from '../../entity/facet-value/facet-value-translation.entity';
import { FacetValue } from '../../entity/facet-value/facet-value.entity';
import { Facet } from '../../entity/facet/facet.entity';
import { EventBus } from '../../event-bus';
import { FacetValueEvent } from '../../event-bus/events/facet-value-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { translateDeep } from '../helpers/utils/translate-entity';

import { ChannelService } from './channel.service';

/**
 * @description
 * Contains methods relating to {@link FacetValue} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class FacetValueService {
    constructor(
        private connection: TransactionalConnection,
        private translatableSaver: TranslatableSaver,
        private configService: ConfigService,
        private customFieldRelationService: CustomFieldRelationService,
        private channelService: ChannelService,
        private eventBus: EventBus,
        private translator: TranslatorService,
        private listQueryBuilder: ListQueryBuilder,
        private requestCache: RequestContextCacheService,
    ) {}

    /**
     * @deprecated Use {@link FacetValueService.findAll findAll(ctx, lang)} instead
     */
    findAll(lang: LanguageCode): Promise<Array<Translated<FacetValue>>>;
    findAll(ctx: RequestContext, lang: LanguageCode): Promise<Array<Translated<FacetValue>>>;
    findAll(
        ctxOrLang: RequestContext | LanguageCode,
        lang?: LanguageCode,
    ): Promise<Array<Translated<FacetValue>>> {
        const [repository, languageCode, channelLanguageCode] =
            ctxOrLang instanceof RequestContext
                ? [
                      this.connection.getRepository(ctxOrLang, FacetValue),
                      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                      lang!,
                      ctxOrLang.channel.defaultLanguageCode,
                  ]
                : [this.connection.rawConnection.getRepository(FacetValue), ctxOrLang, undefined];
        const globalDefaultLanguageCode = this.configService.defaultLanguageCode;
        return repository
            .find({
                relations: { facet: true },
            })
            .then(facetValues =>
                facetValues.map(facetValue =>
                    translateDeep(
                        facetValue,
                        channelLanguageCode
                            ? [languageCode, channelLanguageCode, globalDefaultLanguageCode]
                            : [languageCode, globalDefaultLanguageCode],
                        ['facet'],
                    ),
                ),
            );
    }

    /**
     * @description
     * Returns a PaginatedList of FacetValues.
     *
     * TODO: in v2 this should replace the `findAll()` method.
     * A separate method was created just to avoid a breaking change in v1.9.
     */
    findAllList(
        ctx: RequestContext,
        options?: ListQueryOptions<FacetValue>,
        relations?: RelationPaths<FacetValue>,
    ): Promise<PaginatedList<Translated<FacetValue>>> {
        return this.listQueryBuilder
            .build(FacetValue, options, {
                ctx,
                relations: relations ?? ['facet'],
                channelId: ctx.channelId,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                return {
                    items: items.map(item => this.translator.translate(item, ctx, ['facet'])),
                    totalItems,
                };
            });
    }

    findOne(ctx: RequestContext, id: ID): Promise<Translated<FacetValue> | undefined> {
        return this.connection
            .getRepository(ctx, FacetValue)
            .findOne({
                where: { id },
                relations: { facet: true },
            })
            .then(
                facetValue =>
                    (facetValue && this.translator.translate(facetValue, ctx, ['facet'])) ?? undefined,
            );
    }

    findByIds(ctx: RequestContext, ids: ID[]): Promise<Array<Translated<FacetValue>>> {
        const facetValues = this.connection.findByIdsInChannel(ctx, FacetValue, ids, ctx.channelId, {
            relations: ['facet'],
        });
        return facetValues.then(values =>
            values.map(facetValue => this.translator.translate(facetValue, ctx, ['facet'])),
        );
    }

    /**
     * @description
     * Returns the FacetValues assigned to the given Product which are available in the
     * Channel of the RequestContext. Concurrent calls in the same request are batched into
     * a fixed number of queries.
     *
     * @since 3.8.0
     */
    findByProductId(ctx: RequestContext, productId: ID): Promise<Array<Translated<FacetValue>>> {
        return this.getProductFacetValuesLoader(ctx).load(productId);
    }

    /**
     * Resolving `Product.facetValues` on a product list costs several queries per product
     * otherwise. Held against the RequestContext which also supplies the channel filter, so a
     * single loader cannot mix channels. `cache: false` batches without memoizing, so a write
     * earlier in the request is not masked.
     */
    private getProductFacetValuesLoader(ctx: RequestContext): DataLoader<ID, Array<Translated<FacetValue>>> {
        return this.requestCache.get(
            ctx,
            'FacetValueService.facetValuesByProductId',
            () =>
                new DataLoader<ID, Array<Translated<FacetValue>>>(
                    ids => this.batchLoadProductFacetValues(ctx, ids as ID[]),
                    { cache: false },
                ),
        );
    }

    private async batchLoadProductFacetValues(
        ctx: RequestContext,
        productIds: ID[],
    ): Promise<Array<Array<Translated<FacetValue>>>> {
        const links: Array<{ productId: ID; facetValueId: ID }> = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .innerJoin('product.facetValues', 'facetValue')
            .select('product.id', 'productId')
            .addSelect('facetValue.id', 'facetValueId')
            .where('product.id IN (:...productIds)', { productIds: unique(productIds) })
            // An IN (...) query gives no row order guarantee, so sort to keep the order of
            // `Product.facetValues` stable for API clients.
            .orderBy('facetValue.id', 'ASC')
            .getRawMany();
        // One channel-filtered read for the whole batch.
        const facetValues = await this.findByIds(ctx, unique(links.map(link => link.facetValueId)));
        const facetValuesById = new Map(facetValues.map(facetValue => [String(facetValue.id), facetValue]));
        const byProductId = new Map<string, Array<Translated<FacetValue>>>();
        for (const { productId, facetValueId } of links) {
            const facetValue = facetValuesById.get(String(facetValueId));
            if (!facetValue) {
                // Not in the Channel of the RequestContext
                continue;
            }
            const existing = byProductId.get(String(productId));
            if (existing) {
                existing.push(facetValue);
            } else {
                byProductId.set(String(productId), [facetValue]);
            }
        }
        return productIds.map(id => byProductId.get(String(id)) ?? []);
    }

    /**
     * @description
     * Returns all FacetValues belonging to the Facet with the given id.
     */
    findByFacetId(ctx: RequestContext, id: ID): Promise<Array<Translated<FacetValue>>> {
        return this.connection
            .getRepository(ctx, FacetValue)
            .find({
                where: {
                    facet: { id },
                },
            })
            .then(values => values.map(facetValue => this.translator.translate(facetValue, ctx)));
    }

    /**
     * @description
     * Returns all FacetValues belonging to the Facet with the given id.
     */
    findByFacetIdList(
        ctx: RequestContext,
        id: ID,
        options?: ListQueryOptions<FacetValue>,
        relations?: RelationPaths<FacetValue>,
    ): Promise<PaginatedList<Translated<FacetValue>>> {
        return this.listQueryBuilder
            .build(FacetValue, options, {
                ctx,
                relations: relations ?? ['facet'],
                channelId: ctx.channelId,
                entityAlias: 'facetValue',
            })
            .andWhere('facetValue.facetId = :id', { id })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                return {
                    items: items.map(item => this.translator.translate(item, ctx, ['facet'])),
                    totalItems,
                };
            });
    }

    async create(
        ctx: RequestContext,
        facet: Facet,
        input: CreateFacetValueInput | CreateFacetValueWithFacetInput,
    ): Promise<Translated<FacetValue>> {
        const facetValue = await this.translatableSaver.create({
            ctx,
            input,
            entityType: FacetValue,
            translationType: FacetValueTranslation,
            beforeSave: async fv => {
                fv.facet = facet;
                await this.channelService.assignToCurrentChannel(fv, ctx);
            },
        });
        const facetValueWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            FacetValue,
            input as CreateFacetValueInput,
            facetValue,
        );
        await this.eventBus.publish(new FacetValueEvent(ctx, facetValueWithRelations, 'created', input));
        return assertFound(this.findOne(ctx, facetValue.id));
    }

    async update(ctx: RequestContext, input: UpdateFacetValueInput): Promise<Translated<FacetValue>> {
        // Ensure the entity belongs to the active channel before updating.
        await this.connection.getEntityOrThrow(ctx, FacetValue, input.id, { channelId: ctx.channelId });
        const facetValue = await this.translatableSaver.update({
            ctx,
            input,
            entityType: FacetValue,
            translationType: FacetValueTranslation,
        });
        await this.customFieldRelationService.updateRelations(ctx, FacetValue, input, facetValue);
        await this.eventBus.publish(new FacetValueEvent(ctx, facetValue, 'updated', input));
        return assertFound(this.findOne(ctx, facetValue.id));
    }

    async delete(ctx: RequestContext, id: ID, force: boolean = false): Promise<DeletionResponse> {
        const { productCount, variantCount } = await this.checkFacetValueUsage(ctx, [id]);

        const isInUse = !!(productCount || variantCount);
        const both = !!(productCount && variantCount) ? 'both' : 'single';
        let message = '';
        let result: DeletionResult;

        const facetValue = await this.connection.getEntityOrThrow(ctx, FacetValue, id, {
            channelId: ctx.channelId,
        });
        const i18nVars = {
            products: productCount,
            variants: variantCount,
            both,
            facetValueCode: facetValue.code,
        };
        // Create a new facetValue so that the id is still available
        // after deletion (the .remove() method sets it to undefined)
        const deletedFacetValue = new FacetValue(facetValue);

        if (!isInUse) {
            await this.connection.getRepository(ctx, FacetValue).remove(facetValue);
            await this.eventBus.publish(new FacetValueEvent(ctx, deletedFacetValue, 'deleted', id));
            result = DeletionResult.DELETED;
        } else if (force) {
            await this.connection.getRepository(ctx, FacetValue).remove(facetValue);
            await this.eventBus.publish(new FacetValueEvent(ctx, deletedFacetValue, 'deleted', id));
            message = ctx.translate('message.facet-value-force-deleted', i18nVars);
            result = DeletionResult.DELETED;
        } else {
            message = ctx.translate('message.facet-value-used', i18nVars);
            result = DeletionResult.NOT_DELETED;
        }

        return {
            result,
            message,
        };
    }

    /**
     * @description
     * Checks for usage of the given FacetValues in any Products or Variants, and returns the counts.
     */
    async checkFacetValueUsage(
        ctx: RequestContext,
        facetValueIds: ID[],
        channelId?: ID,
    ): Promise<{ productCount: number; variantCount: number }> {
        const consumingProductsQb = this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .leftJoinAndSelect('product.facetValues', 'facetValues')
            .where('facetValues.id IN (:...facetValueIds)', { facetValueIds })
            .andWhere('product.deletedAt IS NULL');

        const consumingVariantsQb = this.connection
            .getRepository(ctx, ProductVariant)
            .createQueryBuilder('variant')
            .leftJoinAndSelect('variant.facetValues', 'facetValues')
            .where('facetValues.id IN (:...facetValueIds)', { facetValueIds })
            .andWhere('variant.deletedAt IS NULL');

        if (channelId) {
            consumingProductsQb
                .leftJoin('product.channels', 'product_channel')
                .leftJoin('facetValues.channels', 'channel')
                .andWhere('product_channel.id = :channelId')
                .andWhere('channel.id = :channelId')
                .setParameter('channelId', channelId);
            consumingVariantsQb
                .leftJoin('variant.channels', 'variant_channel')
                .leftJoin('facetValues.channels', 'channel')
                .andWhere('variant_channel.id = :channelId')
                .andWhere('channel.id = :channelId')
                .setParameter('channelId', channelId);
        }

        return {
            productCount: await consumingProductsQb.getCount(),
            variantCount: await consumingVariantsQb.getCount(),
        };
    }
}
