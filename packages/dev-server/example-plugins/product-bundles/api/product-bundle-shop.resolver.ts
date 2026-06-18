import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UpdateOrderItemsResult } from '@vendure/common/lib/generated-shop-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ACTIVE_ORDER_INPUT_FIELD_NAME,
    ActiveOrderService,
    Ctx,
    ErrorResultUnion,
    Order,
    RequestContext,
    Transaction,
} from '@vendure/core';

import { ProductBundleService } from '../services/product-bundle.service';

@Resolver()
export class ProductBundleShopResolver {
    constructor(
        private productBundleService: ProductBundleService,
        private activeOrderService: ActiveOrderService,
    ) {}

    @Mutation()
    @Transaction()
    async addProductBundleToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: ID },
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined, true);
        return this.productBundleService.addProductBundleToOrder(ctx, order, args.productId);
    }
}
