import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ListQueryOptions, PaginatedList, Permission, RequestContext } from '@vendure/core';

import { RechargeCard } from './recharge-card.entity';
import { RechargeCardBatch } from './recharge-card-batch.entity';
import { CustomerBalance } from './customer-balance.entity';
import { BalanceTransaction } from './balance-transaction.entity';
import { RechargeCardService } from './recharge-card.service';

@Resolver()
export class RechargeCardAdminResolver {
    constructor(private rechargeCardService: RechargeCardService) {}

    @Query()
    @Allow(Permission.ReadSettings)
    async rechargeCards(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<RechargeCard> = { take: 20 },
    ): Promise<PaginatedList<RechargeCard>> {
        return this.rechargeCardService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async rechargeCardBatches(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<RechargeCardBatch> = { take: 20 },
    ): Promise<PaginatedList<RechargeCardBatch>> {
        return this.rechargeCardService.findAllBatches(ctx, options);
    }

    @Mutation()
    @Allow(Permission.UpdateSettings)
    async createRechargeCardBatch(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<any> {
        return this.rechargeCardService.createBatch(ctx, input);
    }

    @Mutation()
    @Allow(Permission.UpdateSettings)
    async freezeRechargeCard(@Ctx() ctx: RequestContext, @Args('id') id: number): Promise<any> {
        return this.rechargeCardService.freezeCard(ctx, id);
    }

    @Mutation()
    @Allow(Permission.UpdateSettings)
    async unfreezeRechargeCard(@Ctx() ctx: RequestContext, @Args('id') id: number): Promise<any> {
        return this.rechargeCardService.unfreezeCard(ctx, id);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async customerBalances(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<CustomerBalance>,
    ): Promise<PaginatedList<CustomerBalance>> {
        return this.rechargeCardService.customerBalances(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async customerBalanceTransactions(
        @Ctx() ctx: RequestContext,
        @Args('customerId') customerId: number,
        @Args('options', { nullable: true }) options: ListQueryOptions<BalanceTransaction>,
    ): Promise<PaginatedList<BalanceTransaction>> {
        return this.rechargeCardService.customerBalanceTransactions(ctx, customerId, options);
    }

    @Mutation()
    @Allow(Permission.UpdateSettings)
    async adminAdjustBalance(@Ctx() ctx: RequestContext, @Args('input') input: any): Promise<any> {
        const newBalance = await this.rechargeCardService.adminAdjustBalance(ctx, input);
        return {
            id: input.customerId,
            customerId: input.customerId,
            channelId: ctx.channelId,
            balance: newBalance,
            frozenBalance: 0,
        };
    }
}
