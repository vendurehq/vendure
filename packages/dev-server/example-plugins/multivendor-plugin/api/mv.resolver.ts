import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';

import { MultivendorService } from '../service/mv.service';
import { CreateSellerInput } from '../types';

@Resolver()
export class MultivendorResolver {
    constructor(private multivendorService: MultivendorService) {}

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    registerNewSeller(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { shopName: string; seller: CreateSellerInput } },
    ) {
        return this.multivendorService.registerNewSeller(ctx, args.input);
    }
}
