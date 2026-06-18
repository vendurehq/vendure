import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { Asset, FulfillmentLine, Order, OrderLine, ProductVariant } from '../../../entity';
import { AssetService, FulfillmentService, OrderService, ProductVariantService } from '../../../service';
import { RequestContext } from '../../common/request-context';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('OrderLine')
export class OrderLineEntityResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private assetService: AssetService,
        private orderService: OrderService,
        private fulfillmentService: FulfillmentService,
    ) {}

    @ResolveField()
    async productVariant(
        @Ctx() ctx: RequestContext,
        @Parent() orderLine: OrderLine,
    ): Promise<ProductVariant> {
        if (orderLine.productVariant) {
            return orderLine.productVariant;
        }
        return this.productVariantService.getVariantByOrderLineId(ctx, orderLine.id);
    }

    @ResolveField()
    async featuredAsset(
        @Ctx() ctx: RequestContext,
        @Parent() orderLine: OrderLine,
    ): Promise<Asset | undefined> {
        // In some scenarios (e.g. modifying an order to add a new item), orderLine.featuredAsset is an object
        // with only an `id`. Since the resolver expects the featuredAsset to be a full Asset object, we need to
        // fetch the full Asset object if it's not already populated.
        if (!orderLine.featuredAsset?.preview) {
            return this.assetService.getFeaturedAsset(ctx, orderLine);
        } else {
            return orderLine.featuredAsset;
        }
    }

    @ResolveField()
    async order(
        @Ctx() ctx: RequestContext,
        @Parent() orderLine: OrderLine,
        @Relations(Order) relations: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        return this.orderService.findOneByOrderLineId(ctx, orderLine.id, relations);
    }

    @ResolveField()
    async fulfillmentLines(
        @Ctx() ctx: RequestContext,
        @Parent() orderLine: OrderLine,
        @Relations(Order) relations: RelationPaths<Order>,
    ): Promise<FulfillmentLine[]> {
        return this.fulfillmentService.getFulfillmentsLinesForOrderLine(ctx, orderLine.id);
    }
}
