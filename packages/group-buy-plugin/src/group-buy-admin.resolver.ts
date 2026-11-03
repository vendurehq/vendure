import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, PaginatedList, Permission, RequestContext, Transaction } from '@vendure/core';

import { GroupBuyActivity } from './group-buy-activity.entity';
import { GroupBuyService } from './group-buy.service';

@Resolver()
export class GroupBuyAdminResolver {
    constructor(private groupBuyService: GroupBuyService) {}

    @Query()
    @Allow(Permission.Authenticated)
    async groupBuyActivities(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<GroupBuyActivity>,
    ): Promise<PaginatedList<GroupBuyActivity>> {
        return this.groupBuyService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async groupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<GroupBuyActivity | undefined> {
        return this.groupBuyService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async createGroupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<GroupBuyActivity> {
        return this.groupBuyService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async updateGroupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<GroupBuyActivity> {
        return this.groupBuyService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async deleteGroupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<boolean> {
        await this.groupBuyService.delete(ctx, id);
        return true;
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async runGroupBuyExpiryCheck(@Ctx() ctx: RequestContext): Promise<boolean> {
        await this.groupBuyService.processExpired(ctx);
        return true;
    }
}
