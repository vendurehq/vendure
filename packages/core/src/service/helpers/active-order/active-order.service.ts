import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { UserInputError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Order } from '../../../entity/order/order.entity';
import { Session } from '../../../entity/session/session.entity';
import { User } from '../../../entity/user/user.entity';
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
        let ownerLocked = false;
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
                    if (!ownerLocked) {
                        // Only a request which is about to create an order has to be serialized,
                        // and it has to look again once it holds the lock: a concurrent request
                        // may have created the order while this one was waiting.
                        await this.lockActiveOrderOwner(ctx);
                        ownerLocked = true;
                        order = await strategy.determineActiveOrder(ctx, strategyInput);
                        if (order) {
                            break;
                        }
                    }
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
        if (order) {
            order = await this.orderService.applyPriceAdjustmentsIfStale(ctx, order);
        }
        return order || undefined;
    }

    /**
     * Determining the active order is a check-then-act: a request which finds no active order goes
     * on to create one. Two concurrent requests can both find nothing and both create, which is how
     * a customer ends up with several active orders.
     *
     * Locking the row the lookup is keyed on serializes those requests, so the second one sees the
     * order the first created. There is no order row to lock at this point, so the lock has to go on
     * the owner: the Session, and the User as well when the request is authenticated, since the
     * fallback lookup for a logged-in customer is by user rather than by session.
     *
     * The lock is taken only once no active order was found, rather than up front, so that the
     * requests for a cart which already exists are serialized by the Order lock alone. It is taken
     * whenever an order is about to be created, including when the session points at an order
     * which is no longer active or belongs to another channel.
     *
     * Locks are taken in the lock order defined on {@link TransactionalConnection}`.lockRow()`, which
     * starts Session, User, Order. Every caller has to use that same order, or two requests can
     * deadlock by taking the same pair the other way round.
     *
     * This is a no-op outside a transaction and on databases without row locking, see
     * {@link TransactionalConnection.lockRow}.
     */
    private async lockActiveOrderOwner(ctx: RequestContext): Promise<void> {
        if (ctx.session) {
            await this.connection.lockRow(ctx, Session, ctx.session.id, { requireReadCommitted: true });
        }
        if (ctx.activeUserId) {
            await this.connection.lockRow(ctx, User, ctx.activeUserId, { requireReadCommitted: true });
        }
        if (ctx.session) {
            // ctx.session is a snapshot taken from the session cache when the request arrived,
            // which is before the lock above was granted. A request which created an order for
            // this session while we were waiting is not visible in that snapshot, so the stored
            // session has to be re-read or we would go on to create a second order.
            const storedSession = await this.connection.getRepository(ctx, Session).findOne({
                where: { id: ctx.session.id },
            });
            if (storedSession) {
                ctx.session.activeOrderId = storedSession.activeOrderId ?? undefined;
            }
        }
    }
}
