import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationCreateSellerArgs,
    MutationDeleteSellerArgs,
    MutationDeleteSellersArgs,
    MutationUpdateSellerArgs,
    Permission,
    QuerySellerArgs,
    QuerySellersArgs,
    SellerList,
} from '@vendure/common/lib/generated-types';

import { Seller } from '../../../entity/seller/seller.entity';
import { SellerService } from '../../../service/services/seller.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Seller')
export class SellerResolver {
    constructor(private sellerService: SellerService) {}

    @Query()
    @Allow(Permission.ReadSeller)
    async sellers(@Ctx() ctx: RequestContext, @Args() args: QuerySellersArgs): Promise<SellerList> {
        return this.sellerService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(Permission.ReadSeller)
    async seller(@Ctx() ctx: RequestContext, @Args() args: QuerySellerArgs): Promise<Seller | undefined> {
        return this.sellerService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSeller)
    async createSeller(@Ctx() ctx: RequestContext, @Args() args: MutationCreateSellerArgs): Promise<Seller> {
        return this.sellerService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSeller)
    async updateSeller(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateSellerArgs): Promise<Seller> {
        return this.sellerService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSeller)
    async deleteSeller(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteSellerArgs,
    ): Promise<DeletionResponse> {
        return this.sellerService.delete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSeller)
    async deleteSellers(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteSellersArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.sellerService.delete(ctx, id)));
    }
}
