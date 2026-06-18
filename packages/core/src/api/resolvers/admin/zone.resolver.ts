import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationAddMembersToZoneArgs,
    MutationCreateZoneArgs,
    MutationDeleteZoneArgs,
    MutationDeleteZonesArgs,
    MutationRemoveMembersFromZoneArgs,
    MutationUpdateZoneArgs,
    Permission,
    QueryZoneArgs,
    QueryZonesArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Zone } from '../../../entity/zone/zone.entity';
import { ZoneService } from '../../../service/services/zone.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class ZoneResolver {
    constructor(private zoneService: ZoneService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadZone)
    zones(@Ctx() ctx: RequestContext, @Args() args: QueryZonesArgs): Promise<PaginatedList<Zone>> {
        return this.zoneService.findAll(ctx, args.options || undefined);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadZone)
    async zone(@Ctx() ctx: RequestContext, @Args() args: QueryZoneArgs): Promise<Zone | undefined> {
        return this.zoneService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreateZone)
    async createZone(@Ctx() ctx: RequestContext, @Args() args: MutationCreateZoneArgs): Promise<Zone> {
        return this.zoneService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateZone)
    async updateZone(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateZoneArgs): Promise<Zone> {
        return this.zoneService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteZone)
    async deleteZone(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteZoneArgs,
    ): Promise<DeletionResponse> {
        return this.zoneService.delete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteZone)
    async deleteZones(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteZonesArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.zoneService.delete(ctx, id)));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateZone)
    async addMembersToZone(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddMembersToZoneArgs,
    ): Promise<Zone> {
        return this.zoneService.addMembersToZone(ctx, args);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateZone)
    async removeMembersFromZone(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveMembersFromZoneArgs,
    ): Promise<Zone> {
        return this.zoneService.removeMembersFromZone(ctx, args);
    }
}
