import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, PaginatedList, Permission, RequestContext, Transaction } from '@vendure/core';

import { InstallmentPlan } from './installment-plan.entity';
import { InstallmentService } from './installment.service';

@Resolver()
export class InstallmentAdminResolver {
    constructor(private installmentService: InstallmentService) {}

    @Query()
    @Allow(Permission.ReadPaymentMethod)
    installmentPlans(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options?: ListQueryOptions<InstallmentPlan>,
    ): Promise<PaginatedList<InstallmentPlan>> {
        return this.installmentService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadPaymentMethod)
    installmentPlan(@Ctx() ctx: RequestContext, @Args('id') id: ID): Promise<InstallmentPlan | undefined> {
        return this.installmentService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.CreatePaymentMethod)
    createInstallmentPlan(@Ctx() ctx: RequestContext, @Args('input') input: any): Promise<InstallmentPlan> {
        return this.installmentService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdatePaymentMethod)
    updateInstallmentPlan(@Ctx() ctx: RequestContext, @Args('input') input: any): Promise<InstallmentPlan> {
        return this.installmentService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeletePaymentMethod)
    async deleteInstallmentPlan(@Ctx() ctx: RequestContext, @Args('id') id: ID): Promise<boolean> {
        await this.installmentService.delete(ctx, id);
        return true;
    }
}
