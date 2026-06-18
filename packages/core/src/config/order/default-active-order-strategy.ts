import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';

import { ActiveOrderStrategy } from './active-order-strategy';

/**
 * @description
 * The default {@link ActiveOrderStrategy}, which uses the current {@link Session} to determine
 * the active Order, and requires no additional input in the Shop API since it is based on the
 * session which is part of the RequestContext.
 *
 * @since 1.9.0
 * @docsCategory orders
 */
export class DefaultActiveOrderStrategy implements ActiveOrderStrategy {
    private connection: TransactionalConnection;
    private orderService: import('../../service/services/order.service').OrderService;
    private sessionService: import('../../service/services/session.service').SessionService;

    name: 'default-active-order-strategy';

    async init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        // Lazy import these dependencies to avoid a circular dependency issue in NestJS.
        const { OrderService } = await import('../../service/services/order.service.js');
        const { SessionService } = await import('../../service/services/session.service.js');
        this.orderService = injector.get(OrderService);
        this.sessionService = injector.get(SessionService);
    }

    createActiveOrder(ctx: RequestContext) {
        return this.orderService.create(ctx, ctx.activeUserId);
    }

    async determineActiveOrder(ctx: RequestContext) {
        if (!ctx.session) {
            throw new InternalServerError('error.no-active-session');
        }
        let order = ctx.session.activeOrderId
            ? await this.connection
                  .getRepository(ctx, Order)
                  .createQueryBuilder('order')
                  .leftJoin('order.channels', 'channel')
                  .where('order.id = :orderId', { orderId: ctx.session.activeOrderId })
                  .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
                  .getOne()
            : undefined;
        if (order && order.active === false) {
            // edge case where an inactive order may not have been
            // removed from the session, i.e. the regular process was interrupted
            await this.sessionService.unsetActiveOrder(ctx, ctx.session);
            order = undefined;
        }
        if (!order) {
            if (ctx.activeUserId) {
                order = await this.orderService.getActiveOrderForUser(ctx, ctx.activeUserId);
            }
        }
        return order || undefined;
    }
}
