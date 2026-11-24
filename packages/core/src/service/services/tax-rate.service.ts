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
import { EntityNotFoundError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { createSelfRefreshingCache, SelfRefreshingCache } from '../../common/self-refreshing-cache';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { findOptionsArrayToObject } from '../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { CustomerGroup } from '../../entity/customer-group/customer-group.entity';
import { Region } from '../../entity/region/region.entity';
import { TaxCategory } from '../../entity/tax-category/tax-category.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { EventBus } from '../../event-bus/event-bus';
import { TaxRateEvent } from '../../event-bus/events/tax-rate-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { patchEntity } from '../helpers/utils/patch-entity';

/**
 * @description
 * What {@link TaxRateService} `getApplicableTaxRate()` looks up a rate for: the country of the Order's
 * shipping address, if there is one, and the tax Zone returned by the configured
 * {@link TaxZoneStrategy}.
 *
 * @docsCategory services
 * @docsPage TaxRateService
 * @since 4.0.0
 */
export interface TaxRateTarget {
    countryCode?: string;
    zone: Zone | ID;
}

/**
 * @description
 * A country which two or more zone rates of one TaxCategory match, and which has no country rate
 * for it. Returned by {@link TaxRateService} `findOverlappingZoneRates()`.
 *
 * @docsCategory services
 * @docsPage TaxRateService
 * @since 4.0.0
 */
export interface ZoneTaxRateOverlap {
    countryCode: string;
    taxCategoryId: ID;
    taxRates: TaxRate[];
}

/**
 * The enabled TaxRates, indexed by target and TaxCategory so that a lookup does not scan the list.
 * When several rates share a key, the first rate in the list wins.
 */
interface ActiveTaxRates {
    rates: TaxRate[];
    /** Keyed by `${countryCode}:${categoryId}` */
    byCountry: Map<string, TaxRate>;
    /** Keyed by `${zoneId}:${categoryId}` */
    byZone: Map<string, TaxRate>;
}

function indexActiveTaxRates(rates: TaxRate[]): ActiveTaxRates {
    const byCountry = new Map<string, TaxRate>();
    const byZone = new Map<string, TaxRate>();
    const setFirst = (map: Map<string, TaxRate>, key: string, rate: TaxRate) => {
        if (!map.has(key)) {
            map.set(key, rate);
        }
    };
    for (const rate of rates) {
        if (rate.region?.type === 'country') {
            setFirst(byCountry, `${rate.region.code}:${String(rate.categoryId)}`, rate);
        }
        if (rate.zoneId != null) {
            setFirst(byZone, `${String(rate.zoneId)}:${String(rate.categoryId)}`, rate);
        }
    }
    return { rates, byCountry, byZone };
}

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
    private activeTaxRates: SelfRefreshingCache<ActiveTaxRates, [RequestContext]>;

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
        const hasRegionIdFilter = this.listQueryBuilder.filterObjectHasProperty<TaxRateFilterParameter>(
            options?.filter,
            'regionId',
        );
        const hasCategoryIdFilter = this.listQueryBuilder.filterObjectHasProperty<TaxRateFilterParameter>(
            options?.filter,
            'categoryId',
        );
        if (hasZoneIdFilter) {
            effectiveRelations.push('zone');
            customPropertyMap.zoneId = 'zone.id';
        }
        if (hasRegionIdFilter) {
            effectiveRelations.push('region');
            customPropertyMap.regionId = 'region.id';
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
                relations: findOptionsArrayToObject<TaxRate>(
                    relations ?? ['category', 'zone', 'region', 'customerGroup'],
                ),
            })
            .then(result => result ?? undefined);
    }

    async create(ctx: RequestContext, input: CreateTaxRateInput): Promise<TaxRate> {
        const taxRate = new TaxRate(input);
        taxRate.category = await this.connection.getEntityOrThrow(ctx, TaxCategory, input.categoryId);
        this.assertSingleTarget(input.zoneId, input.regionId);
        if (input.zoneId) {
            taxRate.zone = await this.connection.getEntityOrThrow(ctx, Zone, input.zoneId);
        }
        if (input.regionId) {
            taxRate.region = await this.getCountryOrThrow(ctx, input.regionId);
        }
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
        await this.eventBus.publish(new TaxRateEvent(ctx, newTaxRate, 'created', input));
        return assertFound(this.findOne(ctx, newTaxRate.id));
    }

    async update(ctx: RequestContext, input: UpdateTaxRateInput): Promise<TaxRate> {
        const taxRate = await this.findOne(ctx, input.id);
        if (!taxRate) {
            throw new EntityNotFoundError('TaxRate', input.id);
        }
        // Setting one target clears the other, so check the targets the rate has after the update.
        const nextZoneId = input.zoneId !== undefined ? input.zoneId : input.regionId ? null : taxRate.zoneId;
        const nextRegionId =
            input.regionId !== undefined ? input.regionId : input.zoneId ? null : taxRate.regionId;
        this.assertSingleTarget(nextZoneId, nextRegionId);
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
        } else if (nextZoneId == null) {
            updatedTaxRate.zone = null;
            updatedTaxRate.zoneId = null;
        }
        if (input.regionId) {
            updatedTaxRate.region = await this.getCountryOrThrow(ctx, input.regionId);
        } else if (nextRegionId == null) {
            updatedTaxRate.region = null;
            updatedTaxRate.regionId = null;
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
     * Returns the applicable TaxRate based on the specified target and TaxCategory. Used when calculating Order
     * prices. The most specific rate wins: a country rate for `target.countryCode`, then a rate for
     * `target.zone`, then a default rate with a value of 0.
     *
     * Passing a Zone or zone ID instead of a target finds zone rates only.
     */
    async getApplicableTaxRate(
        ctx: RequestContext,
        targetOrZone: TaxRateTarget | Zone | ID,
        taxCategory: TaxCategory | ID,
    ): Promise<TaxRate> {
        return (await this.findApplicableTaxRate(ctx, targetOrZone, taxCategory)) ?? this.defaultTaxRate;
    }

    /**
     * @description
     * Like `getApplicableTaxRate()`, but returns `undefined` when no configured rate applies, instead of
     * the default rate with a value of 0.
     *
     * @since 4.0.0
     */
    async findApplicableTaxRate(
        ctx: RequestContext,
        targetOrZone: TaxRateTarget | Zone | ID,
        taxCategory: TaxCategory | ID,
    ): Promise<TaxRate | undefined> {
        const target = this.isTarget(targetOrZone) ? targetOrZone : { zone: targetOrZone };
        const { byCountry, byZone } = await this.getActiveTaxRates(ctx);
        const categoryId = String(this.idOf(taxCategory));
        const countryRate = target.countryCode
            ? byCountry.get(`${target.countryCode}:${categoryId}`)
            : undefined;
        return countryRate ?? byZone.get(`${String(this.idOf(target.zone))}:${categoryId}`);
    }

    /**
     * @description
     * Returns the TaxRate that a tax-inclusive price in the Channel includes: the country rate of the
     * Channel's `taxCountryCode` when it is set, otherwise the zone rate of its default tax Zone.
     * With a tax country but no country rate for it, the default tax Zone's zone rate is used.
     * Returns `undefined` when neither exists.
     *
     * @since 4.0.0
     */
    async findIncludedTaxRate(
        ctx: RequestContext,
        channel: Channel,
        taxCategory: TaxCategory | ID,
    ): Promise<TaxRate | undefined> {
        return this.findApplicableTaxRate(
            ctx,
            { countryCode: channel.taxCountryCode ?? undefined, zone: channel.defaultTaxZone },
            taxCategory,
        );
    }

    /**
     * @description
     * Returns the countries which two or more zone rates of the same TaxCategory match, and which
     * have no country rate for that TaxCategory. For such a country, the rate depends on which Zone
     * the {@link TaxZoneStrategy} returns; {@link AddressBasedTaxZoneStrategy} returns the first.
     * Nothing is changed.
     */
    async findOverlappingZoneRates(ctx: RequestContext): Promise<ZoneTaxRateOverlap[]> {
        const { rates, byCountry } = await this.getActiveTaxRates(ctx);
        const zones = await this.connection.getRepository(ctx, Zone).find({ relations: { members: true } });
        const result: ZoneTaxRateOverlap[] = [];
        const byKey = new Map<string, ZoneTaxRateOverlap>();
        for (const rate of rates) {
            if (rate.zoneId == null) {
                continue;
            }
            const zone = zones.find(z => idsAreEqual(z.id, rate.zoneId));
            for (const member of zone?.members ?? []) {
                if (member.type !== 'country') {
                    continue;
                }
                const key = `${member.code}:${rate.categoryId}`;
                let entry = byKey.get(key);
                if (!entry) {
                    entry = { countryCode: member.code, taxCategoryId: rate.categoryId, taxRates: [] };
                    byKey.set(key, entry);
                }
                entry.taxRates.push(rate);
            }
        }
        for (const entry of byKey.values()) {
            const hasCountryRate = byCountry.has(`${entry.countryCode}:${String(entry.taxCategoryId)}`);
            if (entry.taxRates.length > 1 && !hasCountryRate) {
                result.push(entry);
            }
        }
        return result;
    }

    private isTarget(value: unknown): value is TaxRateTarget {
        return typeof value === 'object' && value !== null && 'zone' in value;
    }

    private idOf(entityOrId: { id: ID } | ID): ID {
        return typeof entityOrId === 'object' ? entityOrId.id : entityOrId;
    }

    private assertSingleTarget(zoneId?: ID | null, regionId?: ID | null) {
        if ((zoneId && regionId) || (!zoneId && !regionId)) {
            throw new UserInputError('error.tax-rate-requires-exactly-one-target');
        }
    }

    private async getCountryOrThrow(ctx: RequestContext, regionId: ID): Promise<Region> {
        const region = await this.connection.getRepository(ctx, Region).findOne({ where: { id: regionId } });
        if (!region) {
            throw new EntityNotFoundError('Region', regionId);
        }
        if (region.type !== 'country') {
            throw new UserInputError('error.tax-rate-region-must-be-country', { type: region.type });
        }
        return region;
    }

    private async getActiveTaxRates(ctx: RequestContext): Promise<ActiveTaxRates> {
        return this.activeTaxRates.value(ctx);
    }

    private async updateActiveTaxRates(ctx: RequestContext) {
        await this.activeTaxRates.refresh(ctx);
    }

    private async findActiveTaxRates(ctx: RequestContext): Promise<TaxRate[]> {
        return await this.connection.getRepository(ctx, TaxRate).find({
            relations: { category: true, zone: true, region: true, customerGroup: true },
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
            refresh: {
                fn: async ctx => indexActiveTaxRates(await this.findActiveTaxRates(ctx)),
                defaultArgs: [RequestContext.empty()],
            },
        });
    }
}
