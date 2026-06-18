import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { HistoryEntryListOptions, OrderHistoryArgs, SortOrder } from '@vendure/common/lib/generated-types';

import { assertFound, idsAreEqual } from '../../../common/utils';
import { Order } from '../../../entity/order/order.entity';
import { CustomerService, TranslatorService } from '../../../service/index';
import { HistoryService } from '../../../service/services/history.service';
import { OrderService } from '../../../service/services/order.service';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { Api } from '../../decorators/api.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Order')
export class OrderEntityResolver {
    constructor(
        private orderService: OrderService,
        private customerService: CustomerService,
        private historyService: HistoryService,
        private translator: TranslatorService,
    ) {}

    @ResolveField()
    async payments(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.payments) {
            return order.payments;
        }
        return this.orderService.getOrderPayments(ctx, order.id);
    }

    @ResolveField()
    async fulfillments(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.fulfillments) {
            return order.fulfillments;
        }
        return this.orderService.getOrderFulfillments(ctx, order);
    }

    @ResolveField()
    async surcharges(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.surcharges) {
            return order.surcharges;
        }
        return this.orderService.getOrderSurcharges(ctx, order.id);
    }

    @ResolveField()
    async customer(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.customer) {
            return order.customer;
        }
        if (order.customerId) {
            return this.customerService.findOne(ctx, order.customerId);
        }
    }

    @ResolveField()
    async lines(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.lines) {
            return order.lines;
        }
        const { lines } = await assertFound(this.orderService.findOne(ctx, order.id));
        return lines;
    }

    @ResolveField()
    async shippingLines(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.shippingLines) {
            return order.shippingLines;
        }
        const { shippingLines } = await assertFound(
            this.orderService.findOne(ctx, order.id, ['shippingLines.shippingMethod']),
        );
        return shippingLines;
    }

    @ResolveField()
    async history(
        @Ctx() ctx: RequestContext,
        @Api() apiType: ApiType,
        @Parent() order: Order,
        @Args() args: OrderHistoryArgs,
    ) {
        const publicOnly = apiType === 'shop';
        const options: HistoryEntryListOptions = { ...args.options };
        if (!options.sort) {
            options.sort = { createdAt: SortOrder.ASC };
        }
        return this.historyService.getHistoryForOrder(ctx, order.id, publicOnly, options);
    }

    @ResolveField()
    async promotions(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        // If the order has been hydrated with the promotions, then we can just return those
        // as long as they have the translations joined.
        if (
            order.promotions &&
            (order.promotions.length === 0 ||
                (order.promotions.length > 0 && order.promotions[0].translations))
        ) {
            return order.promotions.map(p => this.translator.translate(p, ctx));
        }
        return this.orderService.getOrderPromotions(ctx, order.id);
    }
}

@Resolver('Order')
export class OrderAdminEntityResolver {
    constructor(private orderService: OrderService) {}

    @ResolveField()
    async channels(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const channels = order.channels ?? (await this.orderService.getOrderChannels(ctx, order));
        return channels.filter(channel =>
            ctx.session?.user?.channelPermissions.find(cp => idsAreEqual(cp.id, channel.id)),
        );
    }

    @ResolveField()
    async modifications(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        if (order.modifications) {
            return order.modifications;
        }
        return this.orderService.getOrderModifications(ctx, order.id);
    }

    @ResolveField()
    async nextStates(@Parent() order: Order) {
        return this.orderService.getNextOrderStates(order);
    }

    @ResolveField()
    async sellerOrders(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const sellerOrders = await this.orderService.getSellerOrders(ctx, order);
        // Only return seller orders on those channels to which the active user has access.
        const userChannelIds = ctx.session?.user?.channelPermissions.map(cp => cp.id) ?? [];
        return sellerOrders.filter(sellerOrder =>
            sellerOrder.channels.find(c => userChannelIds.includes(c.id)),
        );
    }

    @ResolveField()
    async aggregateOrder(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const aggregateOrder = await this.orderService.getAggregateOrder(ctx, order);
        const userChannelIds = ctx.session?.user?.channelPermissions.map(cp => cp.id) ?? [];
        // Only return the aggregate order if the active user has permissions on that channel
        return aggregateOrder &&
            userChannelIds.find(id => aggregateOrder.channels.find(channel => idsAreEqual(channel.id, id)))
            ? aggregateOrder
            : undefined;
    }
}
