import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { idsAreEqual } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Order } from '../../../entity/order/order.entity';
import type { ChannelService } from '../../services/channel.service';

import { compareIdsForLockOrder } from './stock-lock-order';

/**
 * @description
 * Returns a RequestContext scoped to the Channel the Order belongs to, keeping the transaction,
 * user and session of the given context.
 *
 * Every Order is also assigned to the default Channel, so an Administrator working in the
 * default Channel can settle, fulfil, modify or cancel Orders of any Channel. Stock decisions
 * (which StockLocations apply, whether inventory is tracked) must follow the Order's own Channel,
 * not the Channel of whoever triggers the action.
 *
 * The Order's Channel is its non-default Channel. If a plugin has assigned the Order to several
 * non-default Channels, the one with the lowest id is used, so the choice is stable. The default
 * Channel is used when it is the only one (e.g. a multivendor aggregate Order).
 *
 * The Channel is taken from the ChannelService cache, so it is fully loaded (zones, seller,
 * custom fields), just like `ctx.channel` of a normal request.
 *
 * @since 4.0.0
 */
export async function getOrderChannelContext(
    ctx: RequestContext,
    connection: TransactionalConnection,
    channelService: ChannelService,
    orderId: ID,
): Promise<RequestContext> {
    const order = await connection.getRepository(ctx, Order).findOne({
        where: { id: orderId },
        relations: { channels: true },
        loadEagerRelations: false,
    });
    if (!order?.channels?.length) {
        return ctx;
    }
    const nonDefault = order.channels
        .filter(c => c.code !== DEFAULT_CHANNEL_CODE)
        .sort((a, b) => compareIdsForLockOrder(a.id, b.id));
    const orderChannel = nonDefault[0] ?? order.channels.find(c => c.code === DEFAULT_CHANNEL_CODE);
    if (!orderChannel || idsAreEqual(orderChannel.id, ctx.channelId)) {
        return ctx;
    }
    const channel = await channelService.getChannelFromToken(ctx, orderChannel.token);
    return ctx.copy(channel);
}
