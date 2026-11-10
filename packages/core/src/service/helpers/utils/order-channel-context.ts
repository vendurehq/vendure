import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { idsAreEqual } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Order } from '../../../entity/order/order.entity';

/**
 * @description
 * Returns a RequestContext scoped to the Channel the Order belongs to, keeping the transaction,
 * user and session of the given context.
 *
 * Every Order is also assigned to the default Channel, so an Administrator working in the
 * default Channel can settle, fulfil, modify or cancel Orders of any Channel. Stock decisions
 * (which StockLocations apply, whether inventory is tracked) must follow the Order's own Channel,
 * not the Channel of whoever triggers the action. The Order's Channel is its non-default
 * Channel, or the default Channel when that is the only one (e.g. a multivendor aggregate Order).
 *
 * @since 4.0.0
 */
export async function getOrderChannelContext(
    ctx: RequestContext,
    connection: TransactionalConnection,
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
    const channel =
        order.channels.find(c => c.code !== DEFAULT_CHANNEL_CODE) ??
        order.channels.find(c => c.code === DEFAULT_CHANNEL_CODE);
    if (!channel || idsAreEqual(channel.id, ctx.channelId)) {
        return ctx;
    }
    return ctx.copy(channel);
}
