import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, PaginatedList, Permission, RequestContext, Transaction } from '@vendure/core';

import { FlashSaleActivity } from './flash-sale-activity.entity';
import { FlashSaleService } from './flash-sale.service';

@Resolver()
export class FlashSaleAdminResolver {
    constructor(private flashSaleService: FlashSaleService) {}

    @Query()
    @Allow(Permission.Authenticated)
    async flashSaleActivities(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<FlashSaleActivity>,
    ): Promise<PaginatedList<FlashSaleActivity>> {
        return this.flashSaleService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async flashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<FlashSaleActivity | undefined> {
        return this.flashSaleService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async createFlashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<FlashSaleActivity> {
        return this.flashSaleService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async updateFlashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<FlashSaleActivity> {
        return this.flashSaleService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async deleteFlashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<boolean> {
        await this.flashSaleService.delete(ctx, id);
        return true;
    }
}
