import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, PaginatedList, Permission, RequestContext, Transaction } from '@vendure/core';

import { PreSaleActivity } from './pre-sale-activity.entity';
import { PreSaleService } from './pre-sale.service';

@Resolver()
export class PreSaleAdminResolver {
    constructor(private preSaleService: PreSaleService) {}

    @Query()
    @Allow(Permission.ReadPromotion)
    async preSaleActivities(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<PreSaleActivity>,
    ): Promise<PaginatedList<PreSaleActivity>> {
        return this.preSaleService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    async preSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<PreSaleActivity | undefined> {
        return this.preSaleService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.CreatePromotion)
    async createPreSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<PreSaleActivity> {
        return this.preSaleService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdatePromotion)
    async updatePreSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<PreSaleActivity> {
        return this.preSaleService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeletePromotion)
    async deletePreSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<boolean> {
        await this.preSaleService.delete(ctx, id);
        return true;
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    async deliverPreSale(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<PreSaleActivity> {
        return this.preSaleService.deliverPreSale(ctx, id);
    }
}