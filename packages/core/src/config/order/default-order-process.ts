import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { RequestContext } from '../../api/common/request-context';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { OrderModification } from '../../entity/order-modification/order-modification.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { OrderPlacedEvent } from '../../event-bus/events/order-placed-event';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';
import {
    orderItemsAreDelivered,
    orderItemsArePartiallyDelivered,
    orderItemsArePartiallyShipped,
    orderItemsAreShipped,
    orderLinesAreAllCancelled,
    orderTotalIsCovered,
    totalCoveredByPayments,
} from '../../service/helpers/utils/order-utils';

import { OrderProcess } from './order-process';

declare module '../../service/helpers/order-state-machine/order-state' {
    interface OrderStates {
        ArrangingPayment: never;
        PaymentAuthorized: never;
        PaymentSettled: never;
        PartiallyShipped: never;
        Shipped: never;
        PartiallyDelivered: never;
        Delivered: never;
        Modifying: never;
        ArrangingAdditionalPayment: never;
    }
}

/**
 * @description
 * Options which can be passed to the {@link configureDefaultOrderProcess} function
 * to configure an instance of the default {@link OrderProcess}. By default, all
 * options are set to `true`.
 *
 * @docsCategory Orders
 * @docsPage OrderProcess
 * @since 2.0.0
 */
export interface DefaultOrderProcessOptions {
    /**
     * @description
     * Prevents an Order from transitioning out of the `Modifying` state if
     * the Order price has changed and there is no Payment or Refund associated
     * with the Modification.
     *
     * @default true
     */
    checkModificationPayments?: boolean;
    /**
     * @description
     * Prevents an Order from transitioning out of the `ArrangingAdditionalPayment` state if
     * the Order's Payments do not cover the full amount of `totalWithTax`.
     *
     * @default true
     */
    checkAdditionalPaymentsAmount?: boolean;
    /**
     * @description
     * Prevents the transition from `AddingItems` to any other state (apart from `Cancelled`) if
     * and of the ProductVariants no longer exists due to deletion.
     *
     * @default true
     */
    checkAllVariantsExist?: boolean;
    /**
     * @description
     * Prevents transition to the `ArrangingPayment` state if the active Order has no lines.
     *
     * @default true
     */
    arrangingPaymentRequiresContents?: boolean;
    /**
     * @description
     * Prevents transition to the `ArrangingPayment` state if the active Order has no customer
     * associated with it.
     *
     * @default true
     */
    arrangingPaymentRequiresCustomer?: boolean;
    /**
     * @description
     * Prevents transition to the `ArrangingPayment` state if the active Order has no shipping
     * method set.
     *
     * @default true
     */
    arrangingPaymentRequiresShipping?: boolean;
    /**
     * @description
     * Prevents transition to the `ArrangingPayment` state if there is insufficient saleable
     * stock to cover the contents of the Order.
     *
     * @default true
     */
    arrangingPaymentRequiresStock?: boolean;
    /**
     * @description
     * Prevents transition to the `PaymentAuthorized` or `PaymentSettled` states if the order
     * `totalWithTax` amount is not covered by Payment(s) in the corresponding states.
     *
     * @default true
     */
    checkPaymentsCoverTotal?: boolean;
    /**
     * @description
     * Prevents transition to the `Cancelled` state unless all OrderItems are already
     * cancelled.
     *
     * @default true
     */
    checkAllItemsBeforeCancel?: boolean;
    /**
     * @description
     * Prevents transition to the `Shipped`, `PartiallyShipped`, `Delivered` & `PartiallyDelivered` states unless
     * there are corresponding Fulfillments in the correct states to allow this. E.g. `Shipped` only if all items in
     * the Order are part of a Fulfillment which itself is in the `Shipped` state.
     *
     * @default true
     */
    checkFulfillmentStates?: boolean;
}

/**
 * @description
 * Used to configure a customized instance of the default {@link OrderProcess} that ships with Vendure.
 * Using this function allows you to turn off certain checks and constraints that are enabled by default.
 *
 * ```ts
 * import { configureDefaultOrderProcess, VendureConfig } from '\@vendure/core';
 *
 * const myCustomOrderProcess = configureDefaultOrderProcess({
 *   // Disable the constraint that requires
 *   // Orders to have a shipping method assigned
 *   // before payment.
 *   arrangingPaymentRequiresShipping: false,
 * });
 *
 * export const config: VendureConfig = {
 *   orderOptions: {
 *     process: [myCustomOrderProcess],
 *   },
 * };
 * ```
 * The {@link DefaultOrderProcessOptions} type defines all available options. If you require even
 * more customization, you can create your own implementation of the {@link OrderProcess} interface.
 *
 *
 * @docsCategory Orders
 * @docsPage OrderProcess
 * @since 2.0.0
 */
export function configureDefaultOrderProcess(options: DefaultOrderProcessOptions) {
    let connection: TransactionalConnection;
    let productVariantService: import('../../service/index').ProductVariantService;
    let configService: import('../config.service').ConfigService;
    let eventBus: import('../../event-bus/index').EventBus;
    let stockMovementService: import('../../service/index').StockMovementService;
    let stockLevelService: import('../../service/index').StockLevelService;
    let historyService: import('../../service/index').HistoryService;
    let orderSplitter: import('../../service/index').OrderSplitter;

    const orderProcess: OrderProcess<OrderState> = {
        transitions: {
            Created: {
                to: ['AddingItems', 'Draft'],
            },
            Draft: {
                to: ['Cancelled', 'ArrangingPayment'],
            },
            AddingItems: {
                to: ['ArrangingPayment', 'Cancelled'],
            },
            ArrangingPayment: {
                to: ['PaymentAuthorized', 'PaymentSettled', 'AddingItems', 'Cancelled'],
            },
            PaymentAuthorized: {
                to: ['PaymentSettled', 'Cancelled', 'Modifying', 'ArrangingAdditionalPayment'],
            },
            PaymentSettled: {
                to: [
                    'PartiallyDelivered',
                    'Delivered',
                    'PartiallyShipped',
                    'Shipped',
                    'Cancelled',
                    'Modifying',
                    'ArrangingAdditionalPayment',
                ],
            },
            PartiallyShipped: {
                to: ['Shipped', 'PartiallyDelivered', 'Cancelled', 'Modifying'],
            },
            Shipped: {
                to: ['PartiallyDelivered', 'Delivered', 'Cancelled', 'Modifying'],
            },
            PartiallyDelivered: {
                to: ['Delivered', 'Cancelled', 'Modifying'],
            },
            Delivered: {
                to: ['Cancelled'],
            },
            Modifying: {
                to: [
                    'PaymentAuthorized',
                    'PaymentSettled',
                    'PartiallyShipped',
                    'Shipped',
                    'PartiallyDelivered',
                    'ArrangingAdditionalPayment',
                ],
            },
            ArrangingAdditionalPayment: {
                to: [
                    'PaymentAuthorized',
                    'PaymentSettled',
                    'PartiallyShipped',
                    'Shipped',
                    'PartiallyDelivered',
                    'Cancelled',
                ],
            },
            Cancelled: {
                to: [],
            },
        },
        async init(injector) {
            // Lazily import these services to avoid a circular dependency error
            // due to this being used as part of the DefaultConfig
            const ConfigService = await import('../config.service.js').then(m => m.ConfigService);
            const EventBus = await import('../../event-bus/index.js').then(m => m.EventBus);
            const StockMovementService = await import('../../service/index.js').then(
                m => m.StockMovementService,
            );
            const StockLevelService = await import('../../service/index.js').then(m => m.StockLevelService);
            const HistoryService = await import('../../service/index.js').then(m => m.HistoryService);
            const OrderSplitter = await import('../../service/index.js').then(m => m.OrderSplitter);
            const ProductVariantService = await import('../../service/index.js').then(
                m => m.ProductVariantService,
            );
            connection = injector.get(TransactionalConnection);
            productVariantService = injector.get(ProductVariantService);
            configService = injector.get(ConfigService);
            eventBus = injector.get(EventBus);
            stockMovementService = injector.get(StockMovementService);
            stockLevelService = injector.get(StockLevelService);
            historyService = injector.get(HistoryService);
            orderSplitter = injector.get(OrderSplitter);
        },

        async onTransitionStart(fromState, toState, { ctx, order }) {
            if (options.checkModificationPayments !== false && fromState === 'Modifying') {
                const modifications = await connection
                    .getRepository(ctx, OrderModification)
                    .find({ where: { order: { id: order.id } }, relations: ['refund', 'payment'] });
                if (toState === 'ArrangingAdditionalPayment') {
                    if (
                        0 < modifications.length &&
                        modifications.every(modification => modification.isSettled)
                    ) {
                        return 'message.cannot-transition-no-additional-payments-needed';
                    }
                } else {
                    if (modifications.some(modification => !modification.isSettled)) {
                        return 'message.cannot-transition-without-modification-payment';
                    }
                }
            }
            if (
                options.checkAdditionalPaymentsAmount !== false &&
                fromState === 'ArrangingAdditionalPayment'
            ) {
                if (toState === 'Cancelled') {
                    return;
                }
                const existingPayments = await connection.getRepository(ctx, Payment).find({
                    relations: ['refunds'],
                    where: {
                        order: { id: order.id },
                    },
                });
                order.payments = existingPayments;
                const deficit = order.totalWithTax - totalCoveredByPayments(order);
                if (0 < deficit) {
                    return 'message.cannot-transition-from-arranging-additional-payment';
                }
            }
            if (
                options.checkAllVariantsExist !== false &&
                fromState === 'AddingItems' &&
                toState !== 'Cancelled' &&
                order.lines.length > 0
            ) {
                const variantIds = unique(order.lines.map(l => l.productVariant.id));
                const qb = connection
                    .getRepository(ctx, ProductVariant)
                    .createQueryBuilder('variant')
                    .leftJoin('variant.product', 'product')
                    .where('variant.deletedAt IS NULL')
                    .andWhere('product.deletedAt IS NULL')
                    .andWhere('variant.id IN (:...variantIds)', { variantIds });
                const availableVariants = await qb.getMany();
                if (availableVariants.length !== variantIds.length) {
                    return 'message.cannot-transition-order-contains-products-which-are-unavailable';
                }
            }
            if (toState === 'ArrangingPayment') {
                if (options.arrangingPaymentRequiresContents !== false && order.lines.length === 0) {
                    return 'message.cannot-transition-to-payment-when-order-is-empty';
                }
                if (options.arrangingPaymentRequiresCustomer !== false && !order.customer) {
                    return 'message.cannot-transition-to-payment-without-customer';
                }
                if (
                    options.arrangingPaymentRequiresShipping !== false &&
                    (!order.shippingLines || order.shippingLines.length === 0)
                ) {
                    return 'message.cannot-transition-to-payment-without-shipping-method';
                }
                if (options.arrangingPaymentRequiresStock !== false) {
                    const variantsWithInsufficientSaleableStock: ProductVariant[] = [];
                    for (const line of order.lines) {
                        const availableStock = await productVariantService.getSaleableStockLevel(
                            ctx,
                            line.productVariant,
                        );
                        if (line.quantity > availableStock) {
                            variantsWithInsufficientSaleableStock.push(line.productVariant);
                        }
                    }
                    if (variantsWithInsufficientSaleableStock.length) {
                        return ctx.translate(
                            'message.cannot-transition-to-payment-due-to-insufficient-stock',
                            {
                                productVariantNames: variantsWithInsufficientSaleableStock
                                    .map(v => v.name)
                                    .join(', '),
                            },
                        );
                    }
                }
            }
            if (options.checkPaymentsCoverTotal !== false) {
                if (toState === 'PaymentAuthorized') {
                    const hasAnAuthorizedPayment = !!order.payments.find(p => p.state === 'Authorized');
                    if (!orderTotalIsCovered(order, ['Authorized', 'Settled']) || !hasAnAuthorizedPayment) {
                        return 'message.cannot-transition-without-authorized-payments';
                    }
                }
                if (toState === 'PaymentSettled' && !orderTotalIsCovered(order, 'Settled')) {
                    return 'message.cannot-transition-without-settled-payments';
                }
            }
            if (options.checkAllItemsBeforeCancel !== false) {
                if (
                    toState === 'Cancelled' &&
                    fromState !== 'AddingItems' &&
                    fromState !== 'ArrangingPayment'
                ) {
                    if (!orderLinesAreAllCancelled(order)) {
                        return 'message.cannot-transition-unless-all-cancelled';
                    }
                }
            }
            if (options.checkFulfillmentStates !== false) {
                if (toState === 'PartiallyShipped') {
                    const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                    if (!orderItemsArePartiallyShipped(orderWithFulfillments)) {
                        return 'message.cannot-transition-unless-some-order-items-shipped';
                    }
                }
                if (toState === 'Shipped') {
                    const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                    if (!orderItemsAreShipped(orderWithFulfillments)) {
                        return 'message.cannot-transition-unless-all-order-items-shipped';
                    }
                }
                if (toState === 'PartiallyDelivered') {
                    const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                    if (!orderItemsArePartiallyDelivered(orderWithFulfillments)) {
                        return 'message.cannot-transition-unless-some-order-items-delivered';
                    }
                }
                if (toState === 'Delivered') {
                    const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                    if (!orderItemsAreDelivered(orderWithFulfillments)) {
                        return 'message.cannot-transition-unless-all-order-items-delivered';
                    }
                }
            }
        },
        async onTransitionEnd(fromState, toState, data) {
            const { ctx, order } = data;
            const { stockAllocationStrategy, orderPlacedStrategy } = configService.orderOptions;
            if (order.active) {
                const shouldSetAsPlaced = orderPlacedStrategy.shouldSetAsPlaced(
                    ctx,
                    fromState,
                    toState,
                    order,
                );
                if (shouldSetAsPlaced) {
                    order.active = false;
                    order.orderPlacedAt = new Date();
                    await Promise.all(
                        order.lines.map(line => {
                            line.orderPlacedQuantity = line.quantity;
                            return connection
                                .getRepository(ctx, OrderLine)
                                .update(line.id, { orderPlacedQuantity: line.quantity });
                        }),
                    );
                    await eventBus.publish(new OrderPlacedEvent(fromState, toState, ctx, order));
                    await orderSplitter.createSellerOrders(ctx, order);
                }
            }
            const shouldAllocateStock = await stockAllocationStrategy.shouldAllocateStock(
                ctx,
                fromState,
                toState,
                order,
            );
            if (shouldAllocateStock) {
                await stockMovementService.createAllocationsForOrder(ctx, order);
            }
            if (toState === 'Cancelled') {
                order.active = false;
            }
            if (fromState === 'Draft' && toState === 'ArrangingPayment') {
                // Once we exit the Draft state, we can consider the order active,
                // which will allow us to run the OrderPlacedStrategy at the correct point.
                order.active = true;
            }
            await historyService.createHistoryEntryForOrder({
                orderId: order.id,
                type: HistoryEntryType.ORDER_STATE_TRANSITION,
                ctx,
                data: {
                    from: fromState,
                    to: toState,
                },
            });
        },
    };

    async function findOrderWithFulfillments(ctx: RequestContext, id: ID): Promise<Order> {
        return await connection.getEntityOrThrow(ctx, Order, id, {
            relations: ['lines', 'fulfillments', 'fulfillments.lines', 'fulfillments.lines.fulfillment'],
        });
    }

    return orderProcess;
}

/**
 * @description
 * This is the built-in {@link OrderProcess} that ships with Vendure. A customized version of this process
 * can be created using the {@link configureDefaultOrderProcess} function, which allows you to pass in an object
 * to enable/disable certain checks.
 *
 * @docsCategory Orders
 * @docsPage OrderProcess
 * @since 2.0.0
 */
export const defaultOrderProcess = configureDefaultOrderProcess({});
