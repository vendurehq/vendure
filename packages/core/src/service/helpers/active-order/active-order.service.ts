import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { UserInputError } from '../../../common/error/errors';
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
        if (order) {
            order = await this.orderService.applyPriceAdjustmentsIfStale(ctx, order);
        }
        return order || undefined;
    }
}
