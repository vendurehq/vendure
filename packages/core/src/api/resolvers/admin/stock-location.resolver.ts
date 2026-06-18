import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    MutationAssignStockLocationsToChannelArgs,
    MutationCreateStockLocationArgs,
    MutationDeleteStockLocationArgs,
    MutationDeleteStockLocationsArgs,
    MutationRemoveStockLocationsFromChannelArgs,
    MutationUpdateStockLocationArgs,
    Permission,
    QueryStockLocationArgs,
    QueryStockLocationsArgs,
} from '@vendure/common/lib/generated-types';

import { StockLocationService } from '../../../service/services/stock-location.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class StockLocationResolver {
    constructor(private stockLocationService: StockLocationService) {}

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadStockLocation)
    stockLocation(@Ctx() ctx: RequestContext, @Args() args: QueryStockLocationArgs) {
        return this.stockLocationService.findOne(ctx, args.id);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadStockLocation)
    stockLocations(@Ctx() ctx: RequestContext, @Args() args: QueryStockLocationsArgs) {
        return this.stockLocationService.findAll(ctx, args.options);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.CreateStockLocation)
    createStockLocation(@Ctx() ctx: RequestContext, @Args() args: MutationCreateStockLocationArgs) {
        return this.stockLocationService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateStockLocation)
    updateStockLocation(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateStockLocationArgs) {
        return this.stockLocationService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeleteStockLocation)
    deleteStockLocation(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteStockLocationArgs) {
        return this.stockLocationService.delete(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeleteStockLocation)
    deleteStockLocations(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteStockLocationsArgs) {
        return Promise.all(args.input.map(input => this.stockLocationService.delete(ctx, input)));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.CreateStockLocation)
    assignStockLocationsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignStockLocationsToChannelArgs,
    ) {
        return this.stockLocationService.assignStockLocationsToChannel(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeleteStockLocation)
    removeStockLocationsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveStockLocationsFromChannelArgs,
    ) {
        return this.stockLocationService.removeStockLocationsFromChannel(ctx, args.input);
    }
}
