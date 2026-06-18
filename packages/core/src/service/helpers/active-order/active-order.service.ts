import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError, UserInputError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Order } from '../../../entity/order/order.entity';
import { OrderService } from '../../services/order.service';
import { SessionService } from '../../services/session.service';

/**
 * @description
 * This helper class is used to get a reference to the active Order from the current RequestContext.
 *
 * @docsCategory orders
 */
@Injectable()
export class ActiveOrderService {
    constructor(
        private sessionService: SessionService,
        private orderService: OrderService,
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * Gets the active Order object from the current Session. Optionally can create a new Order if
     * no active Order exists.
     *
     * Intended to be used at the Resolver layer for those resolvers that depend upon an active Order
     * being present.
     *
     * @deprecated From v1.9.0, use the `getActiveOrder` method which uses any configured ActiveOrderStrategies
     */
    async getOrderFromContext(ctx: RequestContext): Promise<Order | undefined>;
    async getOrderFromContext(ctx: RequestContext, createIfNotExists: true): Promise<Order>;
    async getOrderFromContext(ctx: RequestContext, createIfNotExists = false): Promise<Order | undefined> {
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

            if (!order && createIfNotExists) {
                order = await this.orderService.create(ctx, ctx.activeUserId);
            }

            if (order) {
                await this.sessionService.setActiveOrder(ctx, ctx.session, order);
            }
        }
        return order || undefined;
    }

    /**
     * @description
     * Retrieves the active Order based on the configured {@link ActiveOrderStrategy}.
     *
     * @since 1.9.0
     */
    async getActiveOrder(
        ctx: RequestContext,
        input: { [strategyName: string]: any } | undefined,
    ): Promise<Order | undefined>;
    async getActiveOrder(
        ctx: RequestContext,
        input: { [strategyName: string]: any } | undefined,
        createIfNotExists: true,
    ): Promise<Order>;
    async getActiveOrder(
        ctx: RequestContext,
        input: { [strategyName: string]: Record<string, any> | undefined } | undefined,
        createIfNotExists = false,
    ): Promise<Order | undefined> {
        let order: Order | undefined;
        if (!order) {
            const { activeOrderStrategy } = this.configService.orderOptions;
            const strategyArray = Array.isArray(activeOrderStrategy)
                ? activeOrderStrategy
                : [activeOrderStrategy];
            for (const strategy of strategyArray) {
                const strategyInput = input?.[strategy.name] ?? {};
                order = await strategy.determineActiveOrder(ctx, strategyInput);
                if (order) {
                    break;
                }
                if (createIfNotExists && typeof strategy.createActiveOrder === 'function') {
                    order = await strategy.createActiveOrder(ctx, strategyInput);
                }
                if (order) {
                    break;
                }
            }

            if (!order && createIfNotExists) {
                // No order has been found, and none could be created, which indicates that
                // none of the configured strategies have a `createActiveOrder` method defined.
                // In this case, we should throw an error because it is assumed that such a configuration
                // indicates that an external order creation mechanism should be defined.
                throw new UserInputError('error.order-could-not-be-determined-or-created');
            }

            if (order && ctx.session) {
                const orderAlreadyAssignedToSession =
                    ctx.session.activeOrderId && idsAreEqual(ctx.session.activeOrderId, order.id);
                if (!orderAlreadyAssignedToSession) {
                    await this.sessionService.setActiveOrder(ctx, ctx.session, order);
                }
            }
        }
        return order || undefined;
    }
}
