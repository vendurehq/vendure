import { Injectable } from '@nestjs/common';
import {
    AssignFacetsToChannelInput,
    CreateFacetInput,
    DeletionResponse,
    DeletionResult,
    LanguageCode,
    Permission,
    RemoveFacetFromChannelResult,
    RemoveFacetsFromChannelInput,
    UpdateFacetInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { ErrorResultUnion, FacetInUseError, ForbiddenError, Instrument, UserInputError } from '../../common';
import { ListQueryOptions } from '../../common/types/common-types';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { FacetValue } from '../../entity/facet-value/facet-value.entity';
import { FacetTranslation } from '../../entity/facet/facet-translation.entity';
import { Facet } from '../../entity/facet/facet.entity';
import { EventBus } from '../../event-bus';
import { FacetEvent } from '../../event-bus/events/facet-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { translateDeep } from '../helpers/utils/translate-entity';

import { ChannelService } from './channel.service';
import { FacetValueService } from './facet-value.service';
import { RoleService } from './role.service';

/**
 * @description
 * Contains methods relating to {@link Facet} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class FacetService {
    constructor(
        private connection: TransactionalConnection,
        private facetValueService: FacetValueService,
        private translatableSaver: TranslatableSaver,
        private listQueryBuilder: ListQueryBuilder,
        private configService: ConfigService,
        private channelService: ChannelService,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private translator: TranslatorService,
        private roleService: RoleService,
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Facet>,
        relations?: RelationPaths<Facet>,
    ): Promise<PaginatedList<Translated<Facet>>> {
        return this.listQueryBuilder
            .build(Facet, options, {
                relations: relations ?? ['values', 'values.facet', 'channels'],
                ctx,
                channelId: ctx.channelId,
            })
            .getManyAndCount()
            .then(([facets, totalItems]) => {
                const items = facets.map(facet =>
                    this.translator.translate(facet, ctx, ['values', ['values', 'facet']]),
                );
                return {
                    items,
                    totalItems,
                };
            });
    }

    findOne(
        ctx: RequestContext,
        facetId: ID,
        relations?: RelationPaths<Facet>,
    ): Promise<Translated<Facet> | undefined> {
        return this.connection
            .findOneInChannel(ctx, Facet, facetId, ctx.channelId, {
                relations: relations ?? ['values', 'values.facet', 'channels'],
            })
            .then(
                facet =>
                    (facet && this.translator.translate(facet, ctx, ['values', ['values', 'facet']])) ??
                    undefined,
            );
    }

    /**
     * @deprecated Use {@link FacetService.findByCode findByCode(ctx, facetCode, lang)} instead
     */
    findByCode(facetCode: string, lang: LanguageCode): Promise<Translated<Facet> | undefined>;
    findByCode(
        ctx: RequestContext,
        facetCode: string,
        lang: LanguageCode,
    ): Promise<Translated<Facet> | undefined>;
    findByCode(
        ctxOrFacetCode: RequestContext | string,
        facetCodeOrLang: string | LanguageCode,
        lang?: LanguageCode,
    ): Promise<Translated<Facet> | undefined> {
        const relations = ['values', 'values.facet'];
        const [repository, facetCode, languageCode, channelLanguageCode] =
            ctxOrFacetCode instanceof RequestContext
                ? [
                      this.connection.getRepository(ctxOrFacetCode, Facet),
                      facetCodeOrLang,
                      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                      lang!,
                      ctxOrFacetCode.channel.defaultLanguageCode,
                  ]
                : [
                      this.connection.rawConnection.getRepository(Facet),
                      ctxOrFacetCode,
                      facetCodeOrLang as LanguageCode,
                      undefined,
                  ];
        const globalDefaultLanguageCode = this.configService.defaultLanguageCode;

        return repository
            .findOne({
                where: {
                    code: facetCode,
                },
                relations,
            })
            .then(
                facet =>
                    (facet &&
                        translateDeep(
                            facet,
                            channelLanguageCode
                                ? [languageCode, channelLanguageCode, globalDefaultLanguageCode]
                                : [languageCode, globalDefaultLanguageCode],
                            ['values', ['values', 'facet']],
                        )) ??
                    undefined,
            );
    }

    /**
     * @description
     * Returns the Facet which contains the given FacetValue id.
     */
    async findByFacetValueId(ctx: RequestContext, id: ID): Promise<Translated<Facet> | undefined> {
        const facet = await this.connection
            .getRepository(ctx, Facet)
            .createQueryBuilder('facet')
            .leftJoinAndSelect('facet.translations', 'translations')
            .leftJoin('facet.values', 'facetValue')
            .where('facetValue.id = :id', { id })
            .getOne();
        if (facet) {
            return this.translator.translate(facet, ctx);
        }
    }

    async create(ctx: RequestContext, input: CreateFacetInput): Promise<Translated<Facet>> {
        const facet = await this.translatableSaver.create({
            ctx,
            input,
            entityType: Facet,
            translationType: FacetTranslation,
            beforeSave: async f => {
                f.code = await this.ensureUniqueCode(ctx, f.code);
                await this.channelService.assignToCurrentChannel(f, ctx);
            },
        });
        const facetWithRelations = await this.customFieldRelationService.updateRelations(
            ctx,
            Facet,
            input,
            facet,
        );
        await this.eventBus.publish(new FacetEvent(ctx, facetWithRelations, 'created', input));
        return assertFound(this.findOne(ctx, facet.id));
    }

    async update(ctx: RequestContext, input: UpdateFacetInput): Promise<Translated<Facet>> {
        // Ensure the entity belongs to the active channel before updating.
        await this.connection.getEntityOrThrow(ctx, Facet, input.id, { channelId: ctx.channelId });
        const facet = await this.translatableSaver.update({
            ctx,
            input,
            entityType: Facet,
            translationType: FacetTranslation,
            beforeSave: async f => {
                if (f.code) {
                    f.code = await this.ensureUniqueCode(ctx, f.code, f.id);
                }
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, Facet, input, facet);
        await this.eventBus.publish(new FacetEvent(ctx, facet, 'updated', input));
        return assertFound(this.findOne(ctx, facet.id));
    }

    async delete(ctx: RequestContext, id: ID, force: boolean = false): Promise<DeletionResponse> {
        const facet = await this.connection.getEntityOrThrow(ctx, Facet, id, {
            relations: ['values'],
            channelId: ctx.channelId,
        });
        let productCount = 0;
        let variantCount = 0;
        if (facet.values.length) {
            const counts = await this.facetValueService.checkFacetValueUsage(
                ctx,
                facet.values.map(fv => fv.id),
            );
            productCount = counts.productCount;
            variantCount = counts.variantCount;
        }

        const isInUse = !!(productCount || variantCount);
        const both = !!(productCount && variantCount) ? 'both' : 'single';
        const i18nVars = { products: productCount, variants: variantCount, both, facetCode: facet.code };
        let message = '';
        let result: DeletionResult;
        const deletedFacet = new Facet(facet);

        if (!isInUse) {
            await this.connection.getRepository(ctx, Facet).remove(facet);
            await this.eventBus.publish(new FacetEvent(ctx, deletedFacet, 'deleted', id));
            result = DeletionResult.DELETED;
        } else if (force) {
            await this.connection.getRepository(ctx, Facet).remove(facet);
            await this.eventBus.publish(new FacetEvent(ctx, deletedFacet, 'deleted', id));
            message = ctx.translate('message.facet-force-deleted', i18nVars);
            result = DeletionResult.DELETED;
        } else {
            message = ctx.translate('message.facet-used', i18nVars);
            result = DeletionResult.NOT_DELETED;
        }

        return {
            result,
            message,
        };
    }

    /**
     * Checks to ensure the Facet code is unique. If there is a conflict, then the code is suffixed
     * with an incrementing integer.
     */
    private async ensureUniqueCode(ctx: RequestContext, code: string, id?: ID) {
        let candidate = code;
        let suffix = 1;
        let conflict = false;
        const alreadySuffixed = /-\d+$/;
        do {
            const match = await this.connection
                .getRepository(ctx, Facet)
                .findOne({ where: { code: candidate } });

            conflict = !!match && ((id != null && !idsAreEqual(match.id, id)) || id == null);
            if (conflict) {
                suffix++;
                if (alreadySuffixed.test(candidate)) {
                    candidate = candidate.replace(alreadySuffixed, `-${suffix}`);
                } else {
                    candidate = `${candidate}-${suffix}`;
                }
            }
        } while (conflict);

        return candidate;
    }

    /**
     * @description
     * Assigns Facets to the specified Channel
     */
    async assignFacetsToChannel(
        ctx: RequestContext,
        input: AssignFacetsToChannelInput,
    ): Promise<Array<Translated<Facet>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.UpdateFacet,
            Permission.UpdateCatalog,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const facetsToAssign = await this.connection
            .getRepository(ctx, Facet)
            .find({ where: { id: In(input.facetIds) }, relations: ['values'] });
        const valuesToAssign = facetsToAssign.reduce(
            (values, facet) => [...values, ...facet.values],
            [] as FacetValue[],
        );

        await Promise.all<any>([
            ...facetsToAssign.map(async facet => {
                return this.channelService.assignToChannels(ctx, Facet, facet.id, [input.channelId]);
            }),
            ...valuesToAssign.map(async value =>
                this.channelService.assignToChannels(ctx, FacetValue, value.id, [input.channelId]),
            ),
        ]);
        return this.connection
            .findByIdsInChannel(
                ctx,
                Facet,
                facetsToAssign.map(f => f.id),
                ctx.channelId,
                {},
            )
            .then(facets => facets.map(facet => translateDeep(facet, ctx.languageCode)));
    }

    /**
     * @description
     * Remove Facets from the specified Channel
     */
    async removeFacetsFromChannel(
        ctx: RequestContext,
        input: RemoveFacetsFromChannelInput,
    ): Promise<Array<ErrorResultUnion<RemoveFacetFromChannelResult, Facet>>> {
        const hasPermission = await this.roleService.userHasAnyPermissionsOnChannel(ctx, input.channelId, [
            Permission.DeleteFacet,
            Permission.DeleteCatalog,
        ]);
        if (!hasPermission) {
            throw new ForbiddenError();
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (idsAreEqual(input.channelId, defaultChannel.id)) {
            throw new UserInputError('error.items-cannot-be-removed-from-default-channel');
        }
        const facetsToRemove = await this.connection
            .getRepository(ctx, Facet)
            .find({ where: { id: In(input.facetIds) }, relations: ['values'] });

        const results: Array<ErrorResultUnion<RemoveFacetFromChannelResult, Facet>> = [];

        for (const facet of facetsToRemove) {
            let productCount = 0;
            let variantCount = 0;
            if (facet.values.length) {
                const counts = await this.facetValueService.checkFacetValueUsage(
                    ctx,
                    facet.values.map(fv => fv.id),
                    input.channelId,
                );
                productCount = counts.productCount;
                variantCount = counts.variantCount;

                const isInUse = !!(productCount || variantCount);
                const both = !!(productCount && variantCount) ? 'both' : 'single';
                const i18nVars = { products: productCount, variants: variantCount, both };
                let result: Translated<Facet> | undefined;

                if (!isInUse || input.force) {
                    await this.channelService.removeFromChannels(ctx, Facet, facet.id, [input.channelId]);
                    await Promise.all(
                        facet.values.map(fv =>
                            this.channelService.removeFromChannels(ctx, FacetValue, fv.id, [input.channelId]),
                        ),
                    );
                    result = await this.findOne(ctx, facet.id);
                    if (result) {
                        results.push(result);
                    }
                } else {
                    results.push(new FacetInUseError({ facetCode: facet.code, productCount, variantCount }));
                }
            }
        }

        return results;
    }
}
