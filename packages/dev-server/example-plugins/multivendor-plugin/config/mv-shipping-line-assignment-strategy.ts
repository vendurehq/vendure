import {
    ChannelService,
    EntityHydrator,
    idsAreEqual,
    Injector,
    Order,
    OrderSellerStrategy,
    RequestContext,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';

export class MultivendorShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    private entityHydrator: EntityHydrator;
    private channelService: ChannelService;

    init(injector: Injector) {
        this.entityHydrator = injector.get(EntityHydrator);
        this.channelService = injector.get(ChannelService);
    }

    async assignShippingLineToOrderLines(ctx: RequestContext, shippingLine: ShippingLine, order: Order) {
        // First we need to ensure the required relations are available
        // to work with.
        const defaultChannel = await this.channelService.getDefaultChannel();
        await this.entityHydrator.hydrate(ctx, shippingLine, { relations: ['shippingMethod.channels'] });
        const { channels } = shippingLine.shippingMethod;

        // We assume that, if a ShippingMethod is assigned to exactly 2 Channels,
        // then one is the default Channel and the other is the seller's Channel.
        if (channels.length === 2) {
            const sellerChannel = channels.find(c => !idsAreEqual(c.id, defaultChannel.id));
            if (sellerChannel) {
                // Once we have established the seller's Channel, we can filter the OrderLines
                // that belong to that Channel. The `sellerChannelId` was previously established
                // in the `OrderSellerStrategy.setOrderLineSellerChannel()` method.
                return order.lines.filter(line => idsAreEqual(line.sellerChannelId, sellerChannel.id));
            }
        }
        return order.lines;
    }
}
