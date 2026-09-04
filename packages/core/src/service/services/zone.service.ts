import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    CreateZoneInput,
    DeletionResponse,
    DeletionResult,
    MutationAddMembersToZoneArgs,
    MutationRemoveMembersFromZoneArgs,
    UpdateZoneInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { ZoneCacheStrategy } from '../../config/zone-cache/zone-cache-strategy';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel, TaxRate } from '../../entity';
import { Country } from '../../entity/region/country.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { EventBus } from '../../event-bus';
import { ZoneEvent } from '../../event-bus/events/zone-event';
import { ZoneMembersEvent } from '../../event-bus/events/zone-members-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatorService } from '../helpers/translator/translator.service';
import { patchEntity } from '../helpers/utils/patch-entity';

/**
 * @description
 * Contains methods relating to {@link Zone} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ZoneService implements OnApplicationShutdown {
    private readonly zoneCacheStrategy: ZoneCacheStrategy;
    private zoneCacheStrategyInitialized = false;

    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private eventBus: EventBus,
        private translator: TranslatorService,
        private listQueryBuilder: ListQueryBuilder,
        private customFieldRelationService: CustomFieldRelationService,
        private moduleRef: ModuleRef,
    ) {
        this.zoneCacheStrategy = this.configService.entityOptions.zoneCacheStrategy;
    }

    /** @internal */
    async initZones() {
        if (this.zoneCacheStrategyInitialized) {
            return;
        }
        if (typeof this.zoneCacheStrategy.init === 'function') {
            await this.zoneCacheStrategy.init(new Injector(this.moduleRef));
        }
        this.zoneCacheStrategyInitialized = true;
    }

    /** @internal */
    async onApplicationShutdown() {
        if (this.zoneCacheStrategyInitialized && typeof this.zoneCacheStrategy.destroy === 'function') {
            await this.zoneCacheStrategy.destroy();
        }
    }

    async findAll(ctx: RequestContext, options?: ListQueryOptions<Zone>): Promise<PaginatedList<Zone>> {
        return this.listQueryBuilder
            .build(Zone, options, { relations: ['members'], ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                const translated = items.map((zone, i) => {
                    const cloneZone = { ...zone };
                    cloneZone.members = zone.members.map(country => this.translator.translate(country, ctx));
                    return cloneZone;
                });
                return {
                    items: translated,
                    totalItems,
                };
            });
    }

    findOne(ctx: RequestContext, zoneId: ID): Promise<Zone | undefined> {
        return this.connection
            .getRepository(ctx, Zone)
            .findOne({
                where: { id: zoneId },
                relations: { members: true },
            })
            .then(zone => {
                if (zone) {
                    zone.members = zone.members.map(country => this.translator.translate(country, ctx));
                    return zone;
                }
            });
    }

    async getAllWithMembers(ctx: RequestContext): Promise<Zone[]> {
        const zones = await this.getCachedZones(ctx);
        return zones.map(zone => {
            const cloneZone = { ...zone };
            cloneZone.members = zone.members.map(country => this.translator.translate(country, ctx));
            return cloneZone;
        });
    }

    async create(ctx: RequestContext, input: CreateZoneInput): Promise<Zone> {
        const zone = new Zone(input);
        if (input.memberIds) {
            zone.members = await this.getCountriesFromIds(ctx, input.memberIds);
        }
        const newZone = await this.connection.getRepository(ctx, Zone).save(zone);
        await this.customFieldRelationService.updateRelations(ctx, Zone, input, newZone);
        await this.refreshCachedZones(ctx);
        await this.eventBus.publish(new ZoneEvent(ctx, newZone, 'created', input));
        return assertFound(this.findOne(ctx, newZone.id));
    }

    async update(ctx: RequestContext, input: UpdateZoneInput): Promise<Zone> {
        const zone = await this.connection.getEntityOrThrow(ctx, Zone, input.id);
        const updatedZone = patchEntity(zone, input);
        await this.connection.getRepository(ctx, Zone).save(updatedZone, { reload: false });
        await this.customFieldRelationService.updateRelations(ctx, Zone, input, updatedZone);
        await this.refreshCachedZones(ctx);
        await this.eventBus.publish(new ZoneEvent(ctx, zone, 'updated', input));
        return assertFound(this.findOne(ctx, zone.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const zone = await this.connection.getEntityOrThrow(ctx, Zone, id);
        const deletedZone = new Zone(zone);
        const channelsUsingZone = await this.connection
            .getRepository(ctx, Channel)
            .createQueryBuilder('channel')
            .where('channel.defaultTaxZone = :id', { id })
            .orWhere('channel.defaultShippingZone = :id', { id })
            .getMany();

        if (0 < channelsUsingZone.length) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.zone-used-in-channels', {
                    channelCodes: channelsUsingZone.map(t => t.code).join(', '),
                }),
            };
        }

        const taxRatesUsingZone = await this.connection
            .getRepository(ctx, TaxRate)
            .createQueryBuilder('taxRate')
            .where('taxRate.zone = :id', { id })
            .getMany();

        if (0 < taxRatesUsingZone.length) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('message.zone-used-in-tax-rates', {
                    taxRateNames: taxRatesUsingZone.map(t => t.name).join(', '),
                }),
            };
        } else {
            await this.connection.getRepository(ctx, Zone).remove(zone);
            await this.refreshCachedZones(ctx);
            await this.eventBus.publish(new ZoneEvent(ctx, deletedZone, 'deleted', id));
            return {
                result: DeletionResult.DELETED,
                message: '',
            };
        }
    }

    async addMembersToZone(
        ctx: RequestContext,
        { memberIds, zoneId }: MutationAddMembersToZoneArgs,
    ): Promise<Zone> {
        const countries = await this.getCountriesFromIds(ctx, memberIds);
        const zone = await this.connection.getEntityOrThrow(ctx, Zone, zoneId, {
            relations: ['members'],
        });
        const members = unique(zone.members.concat(countries), 'id');
        zone.members = members;
        await this.connection.getRepository(ctx, Zone).save(zone, { reload: false });
        await this.refreshCachedZones(ctx);
        await this.eventBus.publish(new ZoneMembersEvent(ctx, zone, 'assigned', memberIds));
        return assertFound(this.findOne(ctx, zone.id));
    }

    async removeMembersFromZone(
        ctx: RequestContext,
        { memberIds, zoneId }: MutationRemoveMembersFromZoneArgs,
    ): Promise<Zone> {
        const zone = await this.connection.getEntityOrThrow(ctx, Zone, zoneId, {
            relations: ['members'],
        });
        zone.members = zone.members.filter(country => !memberIds.includes(country.id));
        await this.connection.getRepository(ctx, Zone).save(zone, { reload: false });
        await this.refreshCachedZones(ctx);
        await this.eventBus.publish(new ZoneMembersEvent(ctx, zone, 'removed', memberIds));
        return assertFound(this.findOne(ctx, zone.id));
    }

    private getCountriesFromIds(ctx: RequestContext, ids: ID[]): Promise<Country[]> {
        return this.connection.getRepository(ctx, Country).find({ where: { id: In(ids) } });
    }

    private async getCachedZones(ctx: RequestContext): Promise<Zone[]> {
        return this.zoneCacheStrategy.get(ctx, () => this.loadZones(ctx));
    }

    private async refreshCachedZones(ctx: RequestContext): Promise<void> {
        await this.zoneCacheStrategy.set(ctx, await this.loadZones(ctx));
    }

    private loadZones(ctx: RequestContext): Promise<Zone[]> {
        return this.connection.getRepository(ctx, Zone).find({
            relations: { members: true },
        });
    }
}
