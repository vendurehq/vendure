import { Injectable } from '@nestjs/common';
import {
    CreateTaxRateInput,
    DeletionResponse,
    DeletionResult,
    TaxRateFilterParameter,
    UpdateTaxRateInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { EntityNotFoundError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { createSelfRefreshingCache, SelfRefreshingCache } from '../../common/self-refreshing-cache';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { CustomerGroup } from '../../entity/customer-group/customer-group.entity';
import { TaxCategory } from '../../entity/tax-category/tax-category.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { EventBus } from '../../event-bus/event-bus';
import { TaxRateEvent } from '../../event-bus/events/tax-rate-event';
import { TaxRateModificationEvent } from '../../event-bus/events/tax-rate-modification-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { patchEntity } from '../helpers/utils/patch-entity';

/**
 * @description
 * Contains methods relating to {@link TaxRate} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class TaxRateService {
    private readonly defaultTaxRate = new TaxRate({
        value: 0,
        enabled: true,
        name: 'No configured tax rate',
        id: '0',
    });
    private activeTaxRates: SelfRefreshingCache<TaxRate[], [RequestContext]>;

    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        private listQueryBuilder: ListQueryBuilder,
        private configService: ConfigService,
        private customFieldRelationService: CustomFieldRelationService,
    ) {}

    /**
     * When the app is bootstrapped, ensure the tax rate cache gets created
     * @internal
     */
    async initTaxRates() {
        await this.ensureCacheExists();
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<TaxRate>,
        relations?: RelationPaths<TaxRate>,
    ): Promise<PaginatedList<TaxRate>> {
        const effectiveRelations = relations || ['customerGroup'];
        const customPropertyMap: { [name: string]: string } = {};
        const hasZoneIdFilter = this.listQueryBuilder.filterObjectHasProperty<TaxRateFilterParameter>(
            options?.filter,
            'zoneId',
        );
        const hasCategoryIdFilter = this.listQueryBuilder.filterObjectHasProperty<TaxRateFilterParameter>(
            options?.filter,
            'categoryId',
        );
        if (hasZoneIdFilter) {
            effectiveRelations.push('zone');
            customPropertyMap.zoneId = 'zone.id';
        }
        if (hasCategoryIdFilter) {
            effectiveRelations.push('category');
            customPropertyMap.zoneId = 'category.id';
        }
        return this.listQueryBuilder
            .build(TaxRate, options, {
                relations: effectiveRelations,
                ctx,
                customPropertyMap,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    findOne(
        ctx: RequestContext,
        taxRateId: ID,
        relations?: RelationPaths<TaxRate>,
    ): Promise<TaxRate | undefined> {
        return this.connection
            .getRepository(ctx, TaxRate)
            .findOne({
                where: { id: taxRateId },
                relations: relations ?? ['category', 'zone', 'customerGroup'],
            })
            .then(result => result ?? undefined);
    }

    async create(ctx: RequestContext, input: CreateTaxRateInput): Promise<TaxRate> {
        const taxRate = new TaxRate(input);
        taxRate.category = await this.connection.getEntityOrThrow(ctx, TaxCategory, input.categoryId);
        taxRate.zone = await this.connection.getEntityOrThrow(ctx, Zone, input.zoneId);
        if (input.customerGroupId) {
            taxRate.customerGroup = await this.connection.getEntityOrThrow(
                ctx,
                CustomerGroup,
                input.customerGroupId,
            );
        }
        const newTaxRate = await this.connection.getRepository(ctx, TaxRate).save(taxRate);
        await this.customFieldRelationService.updateRelations(ctx, TaxRate, input, newTaxRate);
        await this.updateActiveTaxRates(ctx);
        await this.eventBus.publish(new TaxRateModificationEvent(ctx, newTaxRate));
        await this.eventBus.publish(new TaxRateEvent(ctx, newTaxRate, 'created', input));
        return assertFound(this.findOne(ctx, newTaxRate.id));
    }

    async update(ctx: RequestContext, input: UpdateTaxRateInput): Promise<TaxRate> {
        const taxRate = await this.findOne(ctx, input.id);
        if (!taxRate) {
            throw new EntityNotFoundError('TaxRate', input.id);
        }
        const updatedTaxRate = patchEntity(taxRate, input);
        if (input.categoryId) {
            updatedTaxRate.category = await this.connection.getEntityOrThrow(
                ctx,
                TaxCategory,
                input.categoryId,
            );
        }
        if (input.zoneId) {
            updatedTaxRate.zone = await this.connection.getEntityOrThrow(ctx, Zone, input.zoneId);
        }
        if (input.customerGroupId) {
            updatedTaxRate.customerGroup = await this.connection.getEntityOrThrow(
                ctx,
                CustomerGroup,
                input.customerGroupId,
            );
        }
        await this.connection.getRepository(ctx, TaxRate).save(updatedTaxRate, { reload: false });
        await this.customFieldRelationService.updateRelations(ctx, TaxRate, input, updatedTaxRate);
        await this.updateActiveTaxRates(ctx);

        // Commit the transaction so that the worker process can access the updated
        // TaxRate when updating its own tax rate cache.
        await this.connection.commitOpenTransaction(ctx);

        await this.eventBus.publish(new TaxRateModificationEvent(ctx, updatedTaxRate));
        await this.eventBus.publish(new TaxRateEvent(ctx, updatedTaxRate, 'updated', input));

        return assertFound(this.findOne(ctx, taxRate.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const taxRate = await this.connection.getEntityOrThrow(ctx, TaxRate, id);
        const deletedTaxRate = new TaxRate(taxRate);
        try {
            await this.connection.getRepository(ctx, TaxRate).remove(taxRate);
            await this.eventBus.publish(new TaxRateEvent(ctx, deletedTaxRate, 'deleted', id));
            return {
                result: DeletionResult.DELETED,
            };
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.toString(),
            };
        }
    }

    /**
     * @description
     * Returns the applicable TaxRate based on the specified Zone and TaxCategory. Used when calculating Order
     * prices.
     */
    async getApplicableTaxRate(
        ctx: RequestContext,
        zone: Zone | ID,
        taxCategory: TaxCategory | ID,
    ): Promise<TaxRate> {
        const rate = (await this.getActiveTaxRates(ctx)).find(r => r.test(zone, taxCategory));
        return rate || this.defaultTaxRate;
    }

    private async getActiveTaxRates(ctx: RequestContext): Promise<TaxRate[]> {
        return this.activeTaxRates.value(ctx);
    }

    private async updateActiveTaxRates(ctx: RequestContext) {
        await this.activeTaxRates.refresh(ctx);
    }

    private async findActiveTaxRates(ctx: RequestContext): Promise<TaxRate[]> {
        return await this.connection.getRepository(ctx, TaxRate).find({
            relations: ['category', 'zone', 'customerGroup'],
            where: {
                enabled: true,
            },
        });
    }

    /**
     * Ensures taxRate cache exists. If not, this method creates one.
     */
    private async ensureCacheExists() {
        if (this.activeTaxRates) {
            return;
        }

        this.activeTaxRates = await createSelfRefreshingCache({
            name: 'TaxRateService.activeTaxRates',
            ttl: this.configService.entityOptions.taxRateCacheTtl,
            refresh: { fn: ctx => this.findActiveTaxRates(ctx), defaultArgs: [RequestContext.empty()] },
        });
    }
}
