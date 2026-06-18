import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { isGraphQlErrorResult } from '../../common/error/error-result';
import { InternalServerError } from '../../common/error/errors';
import { awaitPromiseOrObservable } from '../../common/utils';
import { Fulfillment } from '../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../entity/order/order.entity';
import { FulfillmentState } from '../../service/helpers/fulfillment-state-machine/fulfillment-state';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';
import { orderItemsAreDelivered, orderItemsAreShipped } from '../../service/helpers/utils/order-utils';

import { FulfillmentProcess } from './fulfillment-process';

declare module '../../service/helpers/fulfillment-state-machine/fulfillment-state' {
    interface FulfillmentStates {
        Shipped: never;
        Delivered: never;
    }
}

let connection: import('../../connection/transactional-connection').TransactionalConnection;
let configService: import('../config.service').ConfigService;
let orderService: import('../../service/index').OrderService;
let historyService: import('../../service/index').HistoryService;
let stockMovementService: import('../../service/index').StockMovementService;
let stockLevelService: import('../../service/index').StockLevelService;

/**
 * @description
 * The default {@link FulfillmentProcess}. This process includes the following actions:
 *
 * - Executes the configured `FulfillmentHandler.onFulfillmentTransition()` before any state
 *   transition.
 * - On cancellation of a Fulfillment, creates the necessary {@link Cancellation} & {@link Allocation}
 *   stock movement records.
 * - When a Fulfillment transitions from the `Created` to `Pending` state, the necessary
 *   {@link Sale} stock movements are created.
 *
 * @docsCategory fulfillment
 * @docsPage FulfillmentProcess
 * @since 2.0.0
 */
export const defaultFulfillmentProcess: FulfillmentProcess<FulfillmentState> = {
    transitions: {
        Created: {
            to: ['Pending'],
        },
        Pending: {
            to: ['Shipped', 'Delivered', 'Cancelled'],
        },
        Shipped: {
            to: ['Delivered', 'Cancelled'],
        },
        Delivered: {
            to: ['Cancelled'],
        },
        Cancelled: {
            to: [],
        },
    },
    async init(injector) {
        // Lazily import these services to avoid a circular dependency error
        // due to this being used as part of the DefaultConfig
        const TransactionalConnection = await import('../../connection/transactional-connection.js').then(
            m => m.TransactionalConnection,
        );
        const ConfigService = await import('../config.service.js').then(m => m.ConfigService);
        const HistoryService = await import('../../service/index.js').then(m => m.HistoryService);
        const OrderService = await import('../../service/index.js').then(m => m.OrderService);
        const StockMovementService = await import('../../service/index.js').then(m => m.StockMovementService);
        const StockLevelService = await import('../../service/index.js').then(m => m.StockLevelService);
        connection = injector.get(TransactionalConnection);
        configService = injector.get(ConfigService);
        orderService = injector.get(OrderService);
        historyService = injector.get(HistoryService);
        stockMovementService = injector.get(StockMovementService);
        stockLevelService = injector.get(StockLevelService);
    },
    async onTransitionStart(fromState, toState, data) {
        const { fulfillmentHandlers } = configService.shippingOptions;
        const fulfillmentHandler = fulfillmentHandlers.find(h => h.code === data.fulfillment.handlerCode);
        if (fulfillmentHandler) {
            const result = await awaitPromiseOrObservable(
                fulfillmentHandler.onFulfillmentTransition(fromState, toState, data),
            );
            if (result === false || typeof result === 'string') {
                return result;
            }
        }
    },
    async onTransitionEnd(fromState, toState, { ctx, fulfillment, orders }) {
        if (toState === 'Cancelled') {
            const orderLineInput = fulfillment.lines.map(l => ({
                orderLineId: l.orderLineId,
                quantity: l.quantity,
            }));
            await stockMovementService.createCancellationsForOrderLines(ctx, orderLineInput);
            await stockMovementService.createAllocationsForOrderLines(ctx, orderLineInput);
        }
        if (fromState === 'Created' && toState === 'Pending') {
            await stockMovementService.createSalesForOrder(ctx, fulfillment.lines);
        }
        const historyEntryPromises = orders.map(order =>
            historyService.createHistoryEntryForOrder({
                orderId: order.id,
                type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                ctx,
                data: {
                    fulfillmentId: fulfillment.id,
                    from: fromState,
                    to: toState,
                },
            }),
        );

        await Promise.all(historyEntryPromises);

        await Promise.all(
            orders.map(order =>
                handleFulfillmentStateTransitByOrder(ctx, order, fulfillment, fromState, toState),
            ),
        );
    },
};

async function handleFulfillmentStateTransitByOrder(
    ctx: RequestContext,
    order: Order,
    fulfillment: Fulfillment,
    fromState: FulfillmentState,
    toState: FulfillmentState,
): Promise<void> {
    const nextOrderStates = orderService.getNextOrderStates(order);

    const transitionOrderIfStateAvailable = async (state: OrderState) => {
        if (nextOrderStates.includes(state)) {
            const result = await orderService.transitionToState(ctx, order.id, state);
            if (isGraphQlErrorResult(result)) {
                throw new InternalServerError(result.message);
            }
        }
    };

    if (toState === 'Shipped') {
        const orderWithFulfillment = await getOrderWithFulfillments(ctx, order.id);
        if (orderItemsAreShipped(orderWithFulfillment)) {
            await transitionOrderIfStateAvailable('Shipped');
        } else {
            await transitionOrderIfStateAvailable('PartiallyShipped');
        }
    }
    if (toState === 'Delivered') {
        const orderWithFulfillment = await getOrderWithFulfillments(ctx, order.id);
        if (orderItemsAreDelivered(orderWithFulfillment)) {
            await transitionOrderIfStateAvailable('Delivered');
        } else {
            await transitionOrderIfStateAvailable('PartiallyDelivered');
        }
    }
}

async function getOrderWithFulfillments(ctx: RequestContext, orderId: ID) {
    return await connection.getEntityOrThrow(ctx, Order, orderId, {
        relations: ['lines', 'fulfillments', 'fulfillments.lines', 'fulfillments.lines.fulfillment'],
    });
}
