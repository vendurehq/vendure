import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, PaginatedList, Permission, RequestContext, Transaction } from '@vendure/core';

import { RentalPlan } from './rental-plan.entity';
import { RentalService } from './rental.service';

@Resolver()
export class RentalAdminResolver {
    constructor(private rentalService: RentalService) {}

    @Query()
    @Allow(Permission.ReadCatalog)
    rentalPlans(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options?: ListQueryOptions<RentalPlan>,
    ): Promise<PaginatedList<RentalPlan>> {
        return this.rentalService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    rentalPlan(@Ctx() ctx: RequestContext, @Args('id') id: ID): Promise<RentalPlan | undefined> {
        return this.rentalService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.CreateCatalog)
    createRentalPlan(@Ctx() ctx: RequestContext, @Args('input') input: any): Promise<RentalPlan> {
        return this.rentalService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    updateRentalPlan(@Ctx() ctx: RequestContext, @Args('input') input: any): Promise<RentalPlan> {
        return this.rentalService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeleteCatalog)
    async deleteRentalPlan(@Ctx() ctx: RequestContext, @Args('id') id: ID): Promise<boolean> {
        await this.rentalService.delete(ctx, id);
        return true;
    }
}
