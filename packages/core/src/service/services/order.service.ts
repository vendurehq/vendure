import { Injectable } from '@nestjs/common';
import {
    AddPaymentToOrderResult,
    ApplyCouponCodeResult,
    CurrencyCode,
    PaymentInput,
    PaymentMethodQuote,
    RemoveOrderItemsResult,
    SetOrderShippingMethodResult,
    UpdateOrderItemsResult,
} from '@vendure/common/lib/generated-shop-types';
import {
    AddFulfillmentToOrderResult,
    AddManualPaymentToOrderResult,
    AddNoteToOrderInput,
    AdjustmentType,
    CancelOrderInput,
    CancelOrderResult,
    CancelPaymentResult,
    CreateAddressInput,
    DeletionResponse,
    DeletionResult,
    FulfillOrderInput,
    HistoryEntryType,
    ManualPaymentInput,
    ModifyOrderInput,
    ModifyOrderResult,
    OrderLineInput,
    OrderListOptions,
    OrderProcessState,
    OrderType,
    RefundOrderInput,
    RefundOrderResult,
    SetOrderCustomerInput,
    SettlePaymentResult,
    SettleRefundInput,
    ShippingMethodQuote,
    TransitionPaymentToStateResult,
    UpdateOrderNoteInput,
} from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { In, IsNull } from 'typeorm';
import { FindOptionsUtils } from 'typeorm/find-options/FindOptionsUtils';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { CacheKey } from '../../common/constants';
import { ErrorResultUnion, isGraphQlErrorResult, JustErrorResults } from '../../common/error/error-result';
import { EntityNotFoundError, InternalServerError, UserInputError } from '../../common/error/errors';
import {
    CancelPaymentError,
    EmptyOrderLineSelectionError,
    FulfillmentStateTransitionError,
    InsufficientStockOnHandError,
    ItemsAlreadyFulfilledError,
    ManualPaymentStateError,
    MultipleOrderError,
    NothingToRefundError,
    PaymentOrderMismatchError,
    RefundOrderStateError,
    RefundStateTransitionError,
    SettlePaymentError,
} from '../../common/error/generated-graphql-admin-errors';
import {
    InsufficientStockError,
    NegativeQuantityError,
    OrderInterceptorError,
    OrderLimitError,
    OrderModificationError,
    OrderPaymentStateError,
    OrderStateTransitionError,
    PaymentDeclinedError,
    PaymentFailedError,
} from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { grossPriceOf, netPriceOf } from '../../common/tax-utils';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { Customer } from '../../entity/customer/customer.entity';
import { Fulfillment } from '../../entity/fulfillment/fulfillment.entity';
import { HistoryEntry } from '../../entity/history-entry/history-entry.entity';
import { FulfillmentLine } from '../../entity/order-line-reference/fulfillment-line.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { OrderModification } from '../../entity/order-modification/order-modification.entity';
import { Order } from '../../entity/order/order.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Promotion } from '../../entity/promotion/promotion.entity';
import { Refund } from '../../entity/refund/refund.entity';
import { Session } from '../../entity/session/session.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';
import { Surcharge } from '../../entity/surcharge/surcharge.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus/event-bus';
import { CouponCodeEvent } from '../../event-bus/events/coupon-code-event';
import { OrderEvent } from '../../event-bus/events/order-event';
import { OrderLineEvent } from '../../event-bus/events/order-line-event';
import { OrderStateTransitionEvent } from '../../event-bus/events/order-state-transition-event';
import { RefundEvent } from '../../event-bus/events/refund-event';
import { RefundStateTransitionEvent } from '../../event-bus/events/refund-state-transition-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { FulfillmentState } from '../helpers/fulfillment-state-machine/fulfillment-state';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { OrderCalculator } from '../helpers/order-calculator/order-calculator';
import { OrderMerger } from '../helpers/order-merger/order-merger';
import { OrderModifier } from '../helpers/order-modifier/order-modifier';
import { OrderState } from '../helpers/order-state-machine/order-state';
import { OrderStateMachine } from '../helpers/order-state-machine/order-state-machine';
import { PaymentState } from '../helpers/payment-state-machine/payment-state';
import { RefundState } from '../helpers/refund-state-machine/refund-state';
import { RefundStateMachine } from '../helpers/refund-state-machine/refund-state-machine';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { ShippingCalculator } from '../helpers/shipping-calculator/shipping-calculator';
import { TranslatorService } from '../helpers/translator/translator.service';
import { isForeignKeyViolationError } from '../helpers/utils/db-errors';
import { getOrdersFromLines, totalCoveredByPayments } from '../helpers/utils/order-utils';
import { patchEntity } from '../helpers/utils/patch-entity';

import { ChannelService } from './channel.service';
import { CountryService } from './country.service';
import { CustomerService } from './customer.service';
import { FulfillmentService } from './fulfillment.service';
import { HistoryService } from './history.service';
import { PaymentMethodService } from './payment-method.service';
import { PaymentService } from './payment.service';
import { ProductVariantService } from './product-variant.service';
import { PromotionService } from './promotion.service';
import { StockLevelService } from './stock-level.service';

/**
 * @description
 * Contains methods relating to {@link Order} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class OrderService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private productVariantService: ProductVariantService,
        private customerService: CustomerService,
        private countryService: CountryService,
        private orderCalculator: OrderCalculator,
        private shippingCalculator: ShippingCalculator,
        private orderStateMachine: OrderStateMachine,
        private orderMerger: OrderMerger,
        private paymentService: PaymentService,
        private paymentMethodService: PaymentMethodService,
        private fulfillmentService: FulfillmentService,
        private listQueryBuilder: ListQueryBuilder,
        private refundStateMachine: RefundStateMachine,
        private historyService: HistoryService,
        private promotionService: PromotionService,
        private eventBus: EventBus,
        private channelService: ChannelService,
        private orderModifier: OrderModifier,
        private customFieldRelationService: CustomFieldRelationService,
        private requestCache: RequestContextCacheService,
        private translator: TranslatorService,
        private stockLevelService: StockLevelService,
        private readonly requestContextService: RequestContextService,
    ) {}

    /**
     * @description
     * Returns an array of all the configured states and transitions of the order process. This is
     * based on the default order process plus all configured {@link OrderProcess} objects
     * defined in the {@link OrderOptions} `process` array.
     */
    getOrderProcessStates(): OrderProcessState[] {
        return Object.entries(this.orderStateMachine.config.transitions).map(([name, { to }]) => ({
            name,
            to,
        })) as OrderProcessState[];
    }

    findAll(
        ctx: RequestContext,
        options?: OrderListOptions,
        relations?: RelationPaths<Order>,
    ): Promise<PaginatedList<Order>> {
        return this.listQueryBuilder
            .build(Order, options, {
                ctx,
                relations: relations ?? [
                    'lines',
                    'customer',
                    'lines.productVariant',
                    'channels',
                    'shippingLines',
                    'payments',
                ],
                channelId: ctx.channelId,
                customPropertyMap: {
                    customerLastName: 'customer.lastName',
                    transactionId: 'payments.transactionId',
                },
            })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                return {
                    items,
                    totalItems,
                };
            });
    }

    async findOne(
        ctx: RequestContext,
        orderId: ID,
        relations?: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        const qb = this.connection.getRepository(ctx, Order).createQueryBuilder('order');
        const effectiveRelations = relations ?? [
            'channels',
            'customer',
            'customer.user',
            'lines',
            'lines.productVariant',
            'lines.productVariant.taxCategory',
            'lines.productVariant.productVariantPrices',
            'lines.productVariant.translations',
            'lines.featuredAsset',
            'lines.taxCategory',
            'shippingLines',
            'surcharges',
        ];
        if (
            relations &&
            effectiveRelations.includes('lines.productVariant') &&
            !effectiveRelations.includes('lines.productVariant.taxCategory')
        ) {
            effectiveRelations.push('lines.productVariant.taxCategory');
        }

        // Split relations into two groups for different loading strategies:
        // Main order relations - loaded with 'query' strategy for performance
        const orderRelations = effectiveRelations.filter(r => !r.startsWith('lines'));

        // Lines relations - loaded with 'join' strategy to enable multi-column sorting
        const lineRelations = effectiveRelations
            .filter(r => r.startsWith('lines.'))
            .map(r => r.replace('lines.', ''));

        qb.setFindOptions({
            relations: orderRelations,
            relationLoadStrategy: 'query',
        })
            .leftJoin('order.channels', 'channel')
            .where('order.id = :orderId', { orderId })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId });

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        FindOptionsUtils.joinEagerRelations(qb, qb.alias, qb.expressionMap.mainAlias!.metadata);

        const order = await qb.getOne();

        if (order) {
            const hasLinesRelations = effectiveRelations.some(r => r.startsWith('lines'));
            if (hasLinesRelations) {
                const linesQb = this.connection.getRepository(ctx, OrderLine).createQueryBuilder('line');
                linesQb
                    .setFindOptions({
                        relations: lineRelations,
                    })
                    .where('line.orderId = :orderId', { orderId })
                    .addOrderBy('line.createdAt', 'ASC')
                    .addOrderBy('line.productVariantId', 'ASC');

                const lines = await linesQb.getMany();
                order.lines = lines;
            }

            if (effectiveRelations.includes('lines.productVariant')) {
                for (const line of order.lines) {
                    line.productVariant = this.translator.translate(
                        await this.productVariantService.applyChannelPriceAndTax(
                            line.productVariant,
                            ctx,
                            order,
                        ),
                        ctx,
                    );
                }
            }
            return order;
        }
    }

    async findOneByCode(
        ctx: RequestContext,
        orderCode: string,
        relations?: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            relations: ['customer'],
            where: {
                code: orderCode,
            },
        });
        return order ? this.findOne(ctx, order.id, relations) : undefined;
    }

    async findOneByOrderLineId(
        ctx: RequestContext,
        orderLineId: ID,
        relations?: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        const order = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .innerJoin('order.lines', 'line', 'line.id = :orderLineId', { orderLineId })
            .getOne();

        return order ? this.findOne(ctx, order.id, relations) : undefined;
    }

    async findByCustomerId(
        ctx: RequestContext,
        customerId: ID,
        options?: ListQueryOptions<Order>,
        relations?: RelationPaths<Order>,
    ): Promise<PaginatedList<Order>> {
        const effectiveRelations = (relations ?? ['lines', 'customer', 'channels', 'shippingLines']).filter(
            r =>
                // Don't join productVariant because it messes with the
                // price calculation in certain edge-case field resolver scenarios
                !r.includes('productVariant'),
        );
        return this.listQueryBuilder
            .build(Order, options, {
                relations: relations ?? ['lines', 'customer', 'channels', 'shippingLines'],
                channelId: ctx.channelId,
                ctx,
            })
            .andWhere('order.state != :draftState', { draftState: 'Draft' })
            .andWhere('order.customer.id = :customerId', { customerId })
            .getManyAndCount()
            .then(([items, totalItems]) => {
                return {
                    items,
                    totalItems,
                };
            });
    }

    /**
     * @description
     * Returns all {@link Payment} entities associated with the Order.
     */
    getOrderPayments(ctx: RequestContext, orderId: ID): Promise<Payment[]> {
        return this.connection.getRepository(ctx, Payment).find({
            relations: ['refunds'],
            where: {
                order: { id: orderId } as any,
            },
        });
    }

    /**
     * @description
     * Returns an array of any {@link OrderModification} entities associated with the Order.
     */
    getOrderModifications(ctx: RequestContext, orderId: ID): Promise<OrderModification[]> {
        return this.connection.getRepository(ctx, OrderModification).find({
            where: {
                order: { id: orderId },
            },
            relations: ['lines', 'payment', 'refund', 'surcharges'],
        });
    }

    /**
     * @description
     * Returns any {@link Refund}s associated with a {@link Payment}.
     */
    getPaymentRefunds(ctx: RequestContext, paymentId: ID): Promise<Refund[]> {
        return this.connection.getRepository(ctx, Refund).find({
            where: {
                paymentId,
            },
        });
    }

    getSellerOrders(ctx: RequestContext, order: Order): Promise<Order[]> {
        return this.connection.getRepository(ctx, Order).find({
            where: {
                aggregateOrderId: order.id,
            },
            relations: ['channels'],
        });
    }

    async getAggregateOrder(ctx: RequestContext, order: Order): Promise<Order | undefined> {
        return order.aggregateOrderId == null
            ? undefined
            : this.connection
                  .getRepository(ctx, Order)
                  .findOne({ where: { id: order.aggregateOrderId }, relations: ['channels', 'lines'] })
                  .then(result => result ?? undefined);
    }

    getOrderChannels(ctx: RequestContext, order: Order): Promise<Channel[]> {
        return this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .relation('channels')
            .of(order)
            .loadMany();
    }

    /**
     * @description
     * Returns any Order associated with the specified User's Customer account
     * that is still in the `active` state.
     */
    async getActiveOrderForUser(ctx: RequestContext, userId: ID): Promise<Order | undefined> {
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (customer) {
            const activeOrder = await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder('order')
                .innerJoinAndSelect('order.channels', 'channel', 'channel.id = :channelId', {
                    channelId: ctx.channelId,
                })
                .leftJoinAndSelect('order.customer', 'customer')
                .leftJoinAndSelect('order.shippingLines', 'shippingLines')
                .where('order.active = :active', { active: true })
                .andWhere('order.customer.id = :customerId', { customerId: customer.id })
                .orderBy('order.createdAt', 'DESC')
                .getOne();
            if (activeOrder) {
                return this.findOne(ctx, activeOrder.id);
            }
        }
    }

    /**
     * @description
     * Creates a new, empty Order. If a `userId` is passed, the Order will get associated with that
     * User's Customer account.
     */
    async create(ctx: RequestContext, userId?: ID): Promise<Order> {
        const newOrder = await this.createEmptyOrderEntity(ctx);
        if (userId) {
            const customer = await this.customerService.findOneByUserId(ctx, userId);
            if (customer) {
                newOrder.customer = customer;
            }
        }
        await this.channelService.assignToCurrentChannel(newOrder, ctx);
        const order = await this.connection.getRepository(ctx, Order).save(newOrder);
        await this.eventBus.publish(new OrderEvent(ctx, order, 'created'));
        const transitionResult = await this.transitionToState(ctx, order.id, 'AddingItems');
        if (isGraphQlErrorResult(transitionResult)) {
            // this should never occur, so we will throw rather than return
            throw transitionResult;
        }
        return transitionResult;
    }

    async createDraft(ctx: RequestContext) {
        const newOrder = await this.createEmptyOrderEntity(ctx);
        newOrder.active = false;
        await this.channelService.assignToCurrentChannel(newOrder, ctx);
        const order = await this.connection.getRepository(ctx, Order).save(newOrder);
        await this.eventBus.publish(new OrderEvent(ctx, order, 'created'));
        const transitionResult = await this.transitionToState(ctx, order.id, 'Draft');
        if (isGraphQlErrorResult(transitionResult)) {
            // this should never occur, so we will throw rather than return
            throw transitionResult;
        }
        return transitionResult;
    }

    private async createEmptyOrderEntity(ctx: RequestContext) {
        return new Order({
            type: OrderType.Regular,
            code: await this.configService.orderOptions.orderCodeStrategy.generate(ctx),
            state: this.orderStateMachine.getInitialState(),
            lines: [],
            surcharges: [],
            couponCodes: [],
            modifications: [],
            shippingAddress: {},
            billingAddress: {},
            subTotal: 0,
            subTotalWithTax: 0,
            currencyCode: ctx.currencyCode,
        });
    }

    /**
     * @description
     * Updates the custom fields of an Order.
     */
    async updateCustomFields(ctx: RequestContext, orderId: ID, customFields: any) {
        let order = await this.getOrderOrThrow(ctx, orderId);
        order = patchEntity(order, { customFields });
        const updatedOrder = await this.connection.getRepository(ctx, Order).save(order);
        await this.customFieldRelationService.updateRelations(ctx, Order, { customFields }, updatedOrder);
        await this.eventBus.publish(new OrderEvent(ctx, updatedOrder, 'updated', { customFields }));
        return updatedOrder;
    }

    /**
     * @description
     * Updates the Customer which is assigned to a given Order. The target Customer must be assigned to the same
     * Channels as the Order, otherwise an error will be thrown.
     *
     * @since 2.2.0
     */
    async updateOrderCustomer(ctx: RequestContext, { customerId, orderId, note }: SetOrderCustomerInput) {
        const order = await this.getOrderOrThrow(ctx, orderId, ['channels', 'customer']);
        const currentCustomer = order.customer;
        if (currentCustomer?.id === customerId) {
            // No change in customer, so just return the order as-is
            return order;
        }
        const targetCustomer = await this.customerService.findOne(ctx, customerId, ['channels']);
        if (!targetCustomer) {
            throw new EntityNotFoundError('Customer', customerId);
        }

        // ensure the customer is assigned to the same channels as the order
        const channelIds = order.channels.map(c => c.id);
        const customerChannelIds = targetCustomer.channels.map(c => c.id);
        const missingChannelIds = channelIds.filter(id => !customerChannelIds.includes(id));
        if (missingChannelIds.length) {
            throw new UserInputError(`error.target-customer-not-assigned-to-order-channels`, {
                channelIds: missingChannelIds.join(', '),
            });
        }

        const updatedOrder = await this.addCustomerToOrder(ctx, order.id, targetCustomer);
        await this.eventBus.publish(new OrderEvent(ctx, updatedOrder, 'updated', targetCustomer));
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId,
            type: HistoryEntryType.ORDER_CUSTOMER_UPDATED,
            data: {
                previousCustomerId: currentCustomer?.id,
                previousCustomerName:
                    currentCustomer && `${currentCustomer.firstName} ${currentCustomer.lastName}`,
                newCustomerId: targetCustomer.id,
                newCustomerName: `${targetCustomer.firstName} ${targetCustomer.lastName}`,
                note,
            },
        });
        return updatedOrder;
    }

    /**
     * @description
     * Adds an item to the Order, either creating a new OrderLine or
     * incrementing an existing one.
     *
     * If you need to add multiple items to an Order, use `addItemsToOrder()` instead.
     */
    async addItemToOrder(
        ctx: RequestContext,
        orderId: ID,
        productVariantId: ID,
        quantity: number,
        customFields?: { [key: string]: any },
        relations?: RelationPaths<Order>,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const result = await this.addItemsToOrder(
            ctx,
            orderId,
            [{ productVariantId, quantity, customFields }],
            relations,
        );
        if (result.errorResults.length) {
            return result.errorResults[0];
        } else {
            return result.order;
        }
    }

    async updateOrderCurrency(
        ctx: RequestContext,
        orderId: ID,
        currencyCode: CurrencyCode,
        relations?: RelationPaths<Order>,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        //  Check if order can be modified
        const validationError = this.assertAddingItemsState(order);
        if (validationError) {
            return validationError;
        }

        //  Check if currency is actually changing
        if (order.currencyCode === currencyCode) {
            return order;
        }
        // Verify the new currency is available in the channel
        const channel = await this.channelService.getChannelFromToken(ctx.channel.token);
        if (!channel.availableCurrencyCodes.includes(currencyCode)) {
            throw new UserInputError('error.currency-not-available', { currencyCode });
        }

        const previousCurrencyCode = order.currencyCode;

        const newCurrencyCtx = await this.requestContextService.create({
            req: ctx.req,
            apiType: ctx.apiType,
            languageCode: ctx.languageCode,
            currencyCode,
        });
        order.currencyCode = currencyCode;
        // Create a history entry
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId: order.id,
            type: HistoryEntryType.ORDER_CURRENCY_UPDATED,
            data: {
                previousCurrency: previousCurrencyCode,
                newCurrency: currencyCode,
            },
        });

        const updatedOrder = await this.applyPriceAdjustments(newCurrencyCtx, order, order.lines, relations);

        await this.eventBus.publish(new OrderEvent(ctx, updatedOrder, 'updated'));
        return updatedOrder;
    }

    /**
     * @description
     * Adds multiple items to an Order. This method is more efficient than calling `addItemToOrder`
     * multiple times, as it only needs to fetch the entire Order once, and only performs
     * price adjustments once at the end.
     *
     * Since this method can return multiple error results, it is recommended to check the `errorResults`
     * array to determine if any errors occurred.
     *
     * @since 3.1.0
     */
    async addItemsToOrder(
        ctx: RequestContext,
        orderId: ID,
        items: Array<{
            productVariantId: ID;
            quantity: number;
            customFields?: { [key: string]: any };
        }>,
        relations?: RelationPaths<Order>,
    ): Promise<{ order: Order; errorResults: Array<JustErrorResults<UpdateOrderItemsResult>> }> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const errorResults: Array<JustErrorResults<UpdateOrderItemsResult>> = [];
        const updatedOrderLines: OrderLine[] = [];
        addItem: for (const item of items) {
            const { productVariantId, quantity, customFields } = item;
            const existingOrderLine = await this.orderModifier.getExistingOrderLine(
                ctx,
                order,
                productVariantId,
                customFields,
            );
            const validationError =
                this.assertQuantityIsPositive(quantity) ||
                this.assertAddingItemsState(order) ||
                this.assertNotOverOrderItemsLimit(order, quantity) ||
                this.assertNotOverOrderLineItemsLimit(existingOrderLine, quantity);
            if (validationError) {
                errorResults.push(validationError);
                continue;
            }
            const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, productVariantId, {
                relations: ['product'],
                where: {
                    enabled: true,
                    deletedAt: IsNull(),
                },
                loadEagerRelations: false,
            });
            if (variant.product.enabled === false) {
                throw new EntityNotFoundError('ProductVariant', productVariantId);
            }
            const existingQuantityInOtherLines = summate(
                order.lines.filter(
                    l =>
                        idsAreEqual(l.productVariantId, productVariantId) &&
                        !idsAreEqual(l.id, existingOrderLine?.id),
                ),
                'quantity',
            );
            const correctedQuantity = await this.orderModifier.constrainQuantityToSaleable(
                ctx,
                variant,
                quantity,
                existingOrderLine?.quantity,
                existingQuantityInOtherLines,
            );
            if (correctedQuantity === 0) {
                errorResults.push(
                    new InsufficientStockError({ order, quantityAvailable: correctedQuantity }),
                );
                continue;
            }
            const { orderInterceptors } = this.configService.orderOptions;
            for (const interceptor of orderInterceptors) {
                if (interceptor.willAddItemToOrder) {
                    const error = await interceptor.willAddItemToOrder(ctx, order, {
                        productVariant: variant,
                        quantity: correctedQuantity,
                        customFields,
                    });
                    if (error) {
                        errorResults.push(new OrderInterceptorError({ interceptorError: error }));
                        continue addItem;
                    }
                }
            }
            const orderLine = await this.orderModifier.getOrCreateOrderLine(
                ctx,
                order,
                productVariantId,
                customFields,
            );
            if (correctedQuantity < quantity) {
                const newQuantity = (existingOrderLine ? existingOrderLine?.quantity : 0) + correctedQuantity;
                await this.orderModifier.updateOrderLineQuantity(ctx, orderLine, newQuantity, order);
            } else {
                await this.orderModifier.updateOrderLineQuantity(ctx, orderLine, correctedQuantity, order);
            }
            updatedOrderLines.push(orderLine);
            const quantityWasAdjustedDown = correctedQuantity < quantity;
            if (quantityWasAdjustedDown) {
                errorResults.push(
                    new InsufficientStockError({ quantityAvailable: correctedQuantity, order }),
                );
                continue;
            }
        }
        const updatedOrder = await this.applyPriceAdjustments(ctx, order, updatedOrderLines, relations);
        // for any InsufficientStockError errors, we want to make sure we use the final updatedOrder
        // after having applied all price adjustments
        for (const [i, errorResult] of Object.entries(errorResults)) {
            if (errorResult.__typename === 'InsufficientStockError') {
                errorResults[+i] = new InsufficientStockError({
                    quantityAvailable: errorResult.quantityAvailable,
                    order: updatedOrder,
                });
            }
        }
        return {
            order: updatedOrder,
            errorResults,
        };
    }

    /**
     * @description
     * Adjusts the quantity and/or custom field values of an existing OrderLine.
     *
     * If you need to adjust multiple OrderLines, use `adjustOrderLines()` instead.
     */
    async adjustOrderLine(
        ctx: RequestContext,
        orderId: ID,
        orderLineId: ID,
        quantity: number,
        customFields?: { [key: string]: any },
        relations?: RelationPaths<Order>,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const result = await this.adjustOrderLines(
            ctx,
            orderId,
            [{ orderLineId, quantity, customFields }],
            relations,
        );
        if (result.errorResults.length) {
            return result.errorResults[0];
        } else {
            return result.order;
        }
    }

    /**
     * @description
     * Adjusts the quantity and/or custom field values of existing OrderLines.
     * This method is more efficient than calling `adjustOrderLine` multiple times, as it only needs to fetch
     * the entire Order once, and only performs price adjustments once at the end.
     * Since this method can return multiple error results, it is recommended to check the `errorResults`
     * array to determine if any errors occurred.
     *
     * @since 3.1.0
     */
    async adjustOrderLines(
        ctx: RequestContext,
        orderId: ID,
        lines: Array<{ orderLineId: ID; quantity: number; customFields?: { [key: string]: any } }>,
        relations?: RelationPaths<Order>,
    ): Promise<{ order: Order; errorResults: Array<JustErrorResults<UpdateOrderItemsResult>> }> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const errorResults: Array<JustErrorResults<UpdateOrderItemsResult>> = [];
        const updatedOrderLines: OrderLine[] = [];
        adjustLine: for (const line of lines) {
            const { orderLineId, quantity, customFields } = line;
            const orderLine = this.getOrderLineOrThrow(order, orderLineId);
            const validationError =
                this.assertAddingItemsState(order) ||
                this.assertQuantityIsPositive(quantity) ||
                this.assertNotOverOrderItemsLimit(order, quantity - orderLine.quantity) ||
                this.assertNotOverOrderLineItemsLimit(orderLine, quantity - orderLine.quantity);
            if (validationError) {
                errorResults.push(validationError);
                continue;
            }
            const { orderInterceptors } = this.configService.orderOptions;
            for (const interceptor of orderInterceptors) {
                if (interceptor.willAdjustOrderLine) {
                    const error = await interceptor.willAdjustOrderLine(ctx, order, {
                        orderLine,
                        quantity,
                        customFields,
                    });
                    if (error) {
                        errorResults.push(new OrderInterceptorError({ interceptorError: error }));
                        continue adjustLine;
                    }
                }
            }
            if (customFields != null) {
                // Merge custom fields instead of replacing them entirely
                // This preserves existing values while allowing updates and null-based unsetting
                const existingCustomFields = orderLine.customFields || {};
                const mergedCustomFields = { ...existingCustomFields } as any;

                for (const [key, value] of Object.entries(customFields)) {
                    if (value !== undefined) {
                        // Update with the new value (including explicit null to unset)
                        mergedCustomFields[key] = value;
                    }
                    // If value is undefined, preserve the existing value (don't set it)
                }

                orderLine.customFields = mergedCustomFields;
                await this.customFieldRelationService.updateRelations(
                    ctx,
                    OrderLine,
                    { customFields: mergedCustomFields },
                    orderLine,
                );
            }
            const existingQuantityInOtherLines = summate(
                order.lines.filter(
                    l =>
                        idsAreEqual(l.productVariantId, orderLine.productVariantId) &&
                        !idsAreEqual(l.id, orderLineId),
                ),
                'quantity',
            );
            const correctedQuantity = await this.orderModifier.constrainQuantityToSaleable(
                ctx,
                orderLine.productVariant,
                quantity,
                0,
                existingQuantityInOtherLines,
            );
            if (correctedQuantity === 0) {
                order.lines = order.lines.filter(l => !idsAreEqual(l.id, orderLine.id));
                const deletedOrderLine = new OrderLine(orderLine);
                await this.connection.getRepository(ctx, OrderLine).remove(orderLine);
                await this.eventBus.publish(new OrderLineEvent(ctx, order, deletedOrderLine, 'deleted'));
            } else {
                await this.orderModifier.updateOrderLineQuantity(ctx, orderLine, correctedQuantity, order);
                updatedOrderLines.push(orderLine);
            }
            const quantityWasAdjustedDown = correctedQuantity < quantity;

            if (quantityWasAdjustedDown) {
                errorResults.push(
                    new InsufficientStockError({
                        quantityAvailable: correctedQuantity,
                        order,
                    }),
                );
            }
        }
        const updatedOrder = await this.applyPriceAdjustments(ctx, order, updatedOrderLines, relations);
        for (const [i, errorResult] of Object.entries(errorResults)) {
            if (errorResult.__typename === 'InsufficientStockError') {
                errorResults[+i] = new InsufficientStockError({
                    quantityAvailable: errorResult.quantityAvailable,
                    order: updatedOrder,
                });
            }
        }
        return {
            order: updatedOrder,
            errorResults,
        };
    }

    /**
     * @description
     * Removes the specified OrderLine from the Order.
     *
     * If you need to remove multiple OrderLines, use `removeItemsFromOrder()` instead.
     */
    async removeItemFromOrder(
        ctx: RequestContext,
        orderId: ID,
        orderLineId: ID,
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        return this.removeItemsFromOrder(ctx, orderId, [orderLineId]);
    }

    /**
     * @description
     * Removes the specified OrderLines from the Order.
     * This method is more efficient than calling `removeItemFromOrder` multiple times, as it only needs to fetch
     * the entire Order once, and only performs price adjustments once at the end.
     *
     * @since 3.1.0
     */
    async removeItemsFromOrder(
        ctx: RequestContext,
        orderId: ID,
        orderLineIds: ID[],
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const validationError = this.assertAddingItemsState(order);
        if (validationError) {
            return validationError;
        }
        const orderLinesToDelete: OrderLine[] = [];
        for (const orderLineId of orderLineIds) {
            const orderLine = this.getOrderLineOrThrow(order, orderLineId);
            const { orderInterceptors } = this.configService.orderOptions;
            for (const interceptor of orderInterceptors) {
                if (interceptor.willRemoveItemFromOrder) {
                    const error = await interceptor.willRemoveItemFromOrder(ctx, order, orderLine);
                    if (error) {
                        return new OrderInterceptorError({ interceptorError: error });
                    }
                }
            }
            orderLinesToDelete.push(orderLine);
        }

        order.lines = order.lines.filter(line => !orderLineIds.find(olId => idsAreEqual(line.id, olId)));
        // Persist the orderLine removal before applying price adjustments
        // so that any hydration of the Order entity during the course of the
        // `applyPriceAdjustments()` (e.g. in a ShippingEligibilityChecker etc)
        // will not re-add the OrderLine.
        await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        const updatedOrder = await this.applyPriceAdjustments(ctx, order);
        for (const orderLine of orderLinesToDelete) {
            const deletedOrderLine = new OrderLine(orderLine);
            await this.connection.getRepository(ctx, OrderLine).remove(orderLine);
            await this.eventBus.publish(new OrderLineEvent(ctx, order, deletedOrderLine, 'deleted'));
        }
        return updatedOrder;
    }

    /**
     * @description
     * Removes all OrderLines from the Order.
     */
    async removeAllItemsFromOrder(
        ctx: RequestContext,
        orderId: ID,
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const validationError = this.assertAddingItemsState(order);
        if (validationError) {
            return validationError;
        }

        const { orderInterceptors } = this.configService.orderOptions;
        for (const orderLine of order.lines) {
            for (const interceptor of orderInterceptors) {
                if (interceptor.willRemoveItemFromOrder) {
                    const error = await interceptor.willRemoveItemFromOrder(ctx, order, orderLine);
                    if (error) {
                        return new OrderInterceptorError({ interceptorError: error });
                    }
                }
            }
        }

        await this.connection.getRepository(ctx, OrderLine).remove(order.lines);
        order.lines = [];
        const updatedOrder = await this.applyPriceAdjustments(ctx, order);
        return updatedOrder;
    }

    /**
     * @description
     * Adds a {@link Surcharge} to the Order.
     */
    async addSurchargeToOrder(
        ctx: RequestContext,
        orderId: ID,
        surchargeInput: Partial<Omit<Surcharge, 'id' | 'createdAt' | 'updatedAt' | 'order'>>,
    ): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const surcharge = await this.connection.getRepository(ctx, Surcharge).save(
            new Surcharge({
                taxLines: [],
                sku: '',
                listPriceIncludesTax: ctx.channel.pricesIncludeTax,
                order,
                ...surchargeInput,
            }),
        );
        order.surcharges.push(surcharge);
        const updatedOrder = await this.applyPriceAdjustments(ctx, order);
        return updatedOrder;
    }

    /**
     * @description
     * Removes a {@link Surcharge} from the Order.
     */
    async removeSurchargeFromOrder(ctx: RequestContext, orderId: ID, surchargeId: ID): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const surcharge = await this.connection.getEntityOrThrow(ctx, Surcharge, surchargeId);
        if (order.surcharges.find(s => idsAreEqual(s.id, surcharge.id))) {
            order.surcharges = order.surcharges.filter(s => !idsAreEqual(s.id, surchargeId));
            const updatedOrder = await this.applyPriceAdjustments(ctx, order);
            await this.connection.getRepository(ctx, Surcharge).remove(surcharge);
            return updatedOrder;
        } else {
            return order;
        }
    }

    /**
     * @description
     * Applies a coupon code to the Order, which should be a valid coupon code as specified in the configuration
     * of an active {@link Promotion}.
     */
    async applyCouponCode(
        ctx: RequestContext,
        orderId: ID,
        couponCode: string,
    ): Promise<ErrorResultUnion<ApplyCouponCodeResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        if (order.couponCodes.includes(couponCode)) {
            return order;
        }
        const validationResult = await this.promotionService.validateCouponCode(
            ctx,
            couponCode,
            order.customer && order.customer.id,
        );
        if (isGraphQlErrorResult(validationResult)) {
            return validationResult;
        }
        order.couponCodes.push(couponCode);
        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId: order.id,
            type: HistoryEntryType.ORDER_COUPON_APPLIED,
            data: { couponCode, promotionId: validationResult.id },
        });
        await this.eventBus.publish(new CouponCodeEvent(ctx, couponCode, orderId, 'assigned'));
        return this.applyPriceAdjustments(ctx, order);
    }

    /**
     * @description
     * Removes a coupon code from the Order.
     */
    async removeCouponCode(ctx: RequestContext, orderId: ID, couponCode: string) {
        const order = await this.getOrderOrThrow(ctx, orderId);
        if (order.couponCodes.includes(couponCode)) {
            // When removing a couponCode which has triggered an Order-level discount
            // we need to make sure we persist the changes to the adjustments array of
            // any affected OrderLines.
            const affectedOrderLines = order.lines.filter(
                line =>
                    line.adjustments.filter(a => a.type === AdjustmentType.DISTRIBUTED_ORDER_PROMOTION)
                        .length,
            );
            order.couponCodes = order.couponCodes.filter(cc => cc !== couponCode);
            await this.historyService.createHistoryEntryForOrder({
                ctx,
                orderId: order.id,
                type: HistoryEntryType.ORDER_COUPON_REMOVED,
                data: { couponCode },
            });
            await this.eventBus.publish(new CouponCodeEvent(ctx, couponCode, orderId, 'removed'));
            const result = await this.applyPriceAdjustments(ctx, order);
            await this.connection.getRepository(ctx, OrderLine).save(affectedOrderLines);
            return result;
        } else {
            return order;
        }
    }

    /**
     * @description
     * Returns all {@link Promotion}s associated with an Order.
     */
    async getOrderPromotions(ctx: RequestContext, orderId: ID): Promise<Promotion[]> {
        const order = await this.connection.getEntityOrThrow(ctx, Order, orderId, {
            channelId: ctx.channelId,
            relations: ['promotions'],
        });
        return order.promotions.map(p => this.translator.translate(p, ctx)) || [];
    }

    /**
     * @description
     * Returns the next possible states that the Order may transition to.
     */
    getNextOrderStates(order: Order): readonly OrderState[] {
        return this.orderStateMachine.getNextStates(order);
    }

    /**
     * @description
     * Sets the shipping address for the Order.
     */
    async setShippingAddress(ctx: RequestContext, orderId: ID, input: CreateAddressInput): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const country = await this.countryService.findOneByCode(ctx, input.countryCode);
        const shippingAddress = { ...input, countryCode: input.countryCode, country: country.name };
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .update(Order)
            .set({ shippingAddress })
            .where('id = :id', { id: order.id })
            .execute();
        order.shippingAddress = shippingAddress;
        // Since a changed ShippingAddress could alter the activeTaxZone,
        // we will remove any cached activeTaxZone, so it can be re-calculated
        // as needed.
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone, undefined);
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone_PPA, undefined);
        return this.applyPriceAdjustments(ctx, order, order.lines);
    }

    /**
     * @description
     * Sets the billing address for the Order.
     */
    async setBillingAddress(ctx: RequestContext, orderId: ID, input: CreateAddressInput): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const country = await this.countryService.findOneByCode(ctx, input.countryCode);
        const billingAddress = { ...input, countryCode: input.countryCode, country: country.name };
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .update(Order)
            .set({ billingAddress })
            .where('id = :id', { id: order.id })
            .execute();
        order.billingAddress = billingAddress;
        // Since a changed BillingAddress could alter the activeTaxZone,
        // we will remove any cached activeTaxZone, so it can be re-calculated
        // as needed.
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone, undefined);
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone_PPA, undefined);
        return this.applyPriceAdjustments(ctx, order, order.lines);
    }

    /**
     * @description
     * Unsets the shipping address for the Order.
     *
     * @since 3.1.0
     */
    async unsetShippingAddress(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .update(Order)
            .set({ shippingAddress: {} })
            .where('id = :id', { id: order.id })
            .execute();
        order.shippingAddress = {};
        // Since a changed ShippingAddress could alter the activeTaxZone,
        // we will remove any cached activeTaxZone, so it can be re-calculated
        // as needed.
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone, undefined);
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone_PPA, undefined);
        return this.applyPriceAdjustments(ctx, order, order.lines);
    }

    /**
     * @description
     * Unsets the billing address for the Order.
     *
     * @since 3.1.0
     */
    async unsetBillingAddress(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .update(Order)
            .set({ billingAddress: {} })
            .where('id = :id', { id: order.id })
            .execute();
        order.billingAddress = {};
        // Since a changed BillingAddress could alter the activeTaxZone,
        // we will remove any cached activeTaxZone, so it can be re-calculated
        // as needed.
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone, undefined);
        this.requestCache.set(ctx, CacheKey.ActiveTaxZone_PPA, undefined);
        return this.applyPriceAdjustments(ctx, order, order.lines);
    }

    /**
     * @description
     * Returns an array of quotes stating which {@link ShippingMethod}s may be applied to this Order.
     * This is determined by the configured {@link ShippingEligibilityChecker} of each ShippingMethod.
     *
     * The quote also includes a price for each method, as determined by the configured
     * {@link ShippingCalculator} of each eligible ShippingMethod.
     */
    async getEligibleShippingMethods(ctx: RequestContext, orderId: ID): Promise<ShippingMethodQuote[]> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const eligibleMethods = await this.shippingCalculator.getEligibleShippingMethods(ctx, order);
        return eligibleMethods.map(eligible => {
            const { price, taxRate, priceIncludesTax, metadata } = eligible.result;
            return {
                id: eligible.method.id,
                price: priceIncludesTax ? netPriceOf(price, taxRate) : price,
                priceWithTax: priceIncludesTax ? price : grossPriceOf(price, taxRate),
                description: eligible.method.description,
                name: eligible.method.name,
                code: eligible.method.code,
                metadata,
                customFields: eligible.method.customFields,
            };
        });
    }

    /**
     * @description
     * Returns an array of quotes stating which {@link PaymentMethod}s may be used on this Order.
     */
    async getEligiblePaymentMethods(ctx: RequestContext, orderId: ID): Promise<PaymentMethodQuote[]> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        return this.paymentMethodService.getEligiblePaymentMethods(ctx, order);
    }

    /**
     * @description
     * Sets the ShippingMethod to be used on this Order.
     */
    async setShippingMethod(
        ctx: RequestContext,
        orderId: ID,
        shippingMethodIds: ID[],
    ): Promise<ErrorResultUnion<SetOrderShippingMethodResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        const validationError = this.assertAddingItemsState(order);
        if (validationError) {
            return validationError;
        }
        const result = await this.orderModifier.setShippingMethods(ctx, order, shippingMethodIds);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        const updatedOrder = await this.getOrderOrThrow(ctx, orderId);
        await this.applyPriceAdjustments(ctx, updatedOrder);
        return this.connection.getRepository(ctx, Order).save(updatedOrder);
    }

    /**
     * @description
     * Transitions the Order to the given state.
     */
    async transitionToState(
        ctx: RequestContext,
        orderId: ID,
        state: OrderState,
    ): Promise<Order | OrderStateTransitionError> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        order.payments = await this.getOrderPayments(ctx, orderId);
        const fromState = order.state;
        let finalize: () => Promise<any>;
        try {
            const result = await this.orderStateMachine.transition(ctx, order, state);
            finalize = result.finalize;
        } catch (e: any) {
            const transitionError = ctx.translate(e.message, { fromState, toState: state });
            return new OrderStateTransitionError({ transitionError, fromState, toState: state });
        }
        await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        await this.eventBus.publish(new OrderStateTransitionEvent(fromState, state, ctx, order));
        await finalize();
        await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        return order;
    }

    /**
     * @description
     * Transitions a Fulfillment to the given state and then transitions the Order state based on
     * whether all Fulfillments of the Order are shipped or delivered.
     */
    async transitionFulfillmentToState(
        ctx: RequestContext,
        fulfillmentId: ID,
        state: FulfillmentState,
    ): Promise<Fulfillment | FulfillmentStateTransitionError> {
        const result = await this.fulfillmentService.transitionToState(ctx, fulfillmentId, state);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        return result.fulfillment;
    }

    /**
     * @description
     * Transitions a Refund to the given state
     */
    async transitionRefundToState(
        ctx: RequestContext,
        refundId: ID,
        state: RefundState,
        transactionId?: string,
    ): Promise<Refund | RefundStateTransitionError> {
        const refund = await this.connection.getEntityOrThrow(ctx, Refund, refundId, {
            relations: ['payment', 'payment.order'],
        });
        if (transactionId && refund.transactionId !== transactionId) {
            refund.transactionId = transactionId;
        }
        const fromState = refund.state;
        const toState = state;
        const { finalize } = await this.refundStateMachine.transition(
            ctx,
            refund.payment.order,
            refund,
            toState,
        );
        await this.connection.getRepository(ctx, Refund).save(refund);
        await finalize();
        await this.eventBus.publish(
            new RefundStateTransitionEvent(fromState, toState, ctx, refund, refund.payment.order),
        );
        return refund;
    }

    /**
     * @description
     * Allows the Order to be modified, which allows several aspects of the Order to be changed:
     *
     * * Changes to OrderLine quantities
     * * New OrderLines being added
     * * Arbitrary {@link Surcharge}s being added
     * * Shipping or billing address changes
     *
     * Setting the `dryRun` input property to `true` will apply all changes, including updating the price of the
     * Order, except history entry and additional payment actions.
     *
     * __Using dryRun option, you must wrap function call in transaction manually.__
     *
     */
    async modifyOrder(
        ctx: RequestContext,
        input: ModifyOrderInput,
    ): Promise<ErrorResultUnion<ModifyOrderResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, input.orderId);
        const result = await this.orderModifier.modifyOrder(ctx, input, order);

        if (isGraphQlErrorResult(result)) {
            return result;
        }

        if (input.dryRun) {
            return result.order;
        }

        await this.historyService.createHistoryEntryForOrder({
            ctx,
            orderId: input.orderId,
            type: HistoryEntryType.ORDER_MODIFIED,
            data: {
                modificationId: result.modification.id,
            },
        });
        return this.getOrderOrThrow(ctx, input.orderId);
    }

    /**
     * @description
     * Transitions the given {@link Payment} to a new state.
     */
    async transitionPaymentToState(
        ctx: RequestContext,
        paymentId: ID,
        state: PaymentState,
    ): Promise<ErrorResultUnion<TransitionPaymentToStateResult, Payment>> {
        return this.paymentService.transitionToState(ctx, paymentId, state);
    }

    /**
     * @description
     * Adds a new Payment to the Order. If the Order totalWithTax is covered by Payments, then the Order
     * state will get automatically transitioned to the `PaymentSettled` or `PaymentAuthorized` state.
     */
    async addPaymentToOrder(
        ctx: RequestContext,
        orderId: ID,
        input: PaymentInput,
    ): Promise<ErrorResultUnion<AddPaymentToOrderResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, orderId);
        if (!this.canAddPaymentToOrder(order)) {
            return new OrderPaymentStateError();
        }
        order.payments = await this.getOrderPayments(ctx, order.id);
        const amountToPay = order.totalWithTax - totalCoveredByPayments(order);
        const payment = await this.paymentService.createPayment(
            ctx,
            order,
            amountToPay,
            input.method,
            input.metadata,
        );

        if (isGraphQlErrorResult(payment)) {
            return payment;
        }

        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .relation('payments')
            .of(order)
            .add(payment);

        if (payment.state === 'Error') {
            return new PaymentFailedError({ paymentErrorMessage: payment.errorMessage || '' });
        }
        if (payment.state === 'Declined') {
            return new PaymentDeclinedError({ paymentErrorMessage: payment.errorMessage || '' });
        }

        return assertFound(this.findOne(ctx, order.id));
    }

    /**
     * @description
     * We can add a Payment to the order if:
     * 1. the Order is in the `ArrangingPayment` state or
     * 2. the Order's current state can transition to `PaymentAuthorized` and `PaymentSettled`
     */
    private canAddPaymentToOrder(order: Order): boolean {
        if (order.state === 'ArrangingPayment') {
            return true;
        }
        const canTransitionToPaymentAuthorized = this.orderStateMachine.canTransition(
            order.state,
            'PaymentAuthorized',
        );
        const canTransitionToPaymentSettled = this.orderStateMachine.canTransition(
            order.state,
            'PaymentSettled',
        );
        return canTransitionToPaymentAuthorized && canTransitionToPaymentSettled;
    }

    /**
     * @description
     * This method is used after modifying an existing completed order using the `modifyOrder()` method. If the modifications
     * cause the order total to increase (such as when adding a new OrderLine), then there will be an outstanding charge to
     * pay.
     *
     * This method allows you to add a new Payment and assumes the actual processing has been done manually, e.g. in the
     * dashboard of your payment provider.
     */
    async addManualPaymentToOrder(
        ctx: RequestContext,
        input: ManualPaymentInput,
    ): Promise<ErrorResultUnion<AddManualPaymentToOrderResult, Order>> {
        const order = await this.getOrderOrThrow(ctx, input.orderId);
        if (order.state !== 'ArrangingAdditionalPayment' && order.state !== 'ArrangingPayment') {
            return new ManualPaymentStateError();
        }
        const existingPayments = await this.getOrderPayments(ctx, order.id);
        order.payments = existingPayments;
        const amount = order.totalWithTax - totalCoveredByPayments(order);
        const modifications = await this.getOrderModifications(ctx, order.id);
        const unsettledModifications = modifications.filter(m => !m.isSettled);
        if (0 < unsettledModifications.length) {
            const outstandingModificationsTotal = summate(unsettledModifications, 'priceChange');
            if (outstandingModificationsTotal !== amount) {
                throw new InternalServerError(
                    `The outstanding order amount (${amount}) should equal the unsettled OrderModifications total (${outstandingModificationsTotal})`,
                );
            }
        }

        const payment = await this.paymentService.createManualPayment(ctx, order, amount, input);
        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .relation('payments')
            .of(order)
            .add(payment);
        for (const modification of unsettledModifications) {
            modification.payment = payment;
            await this.connection.getRepository(ctx, OrderModification).save(modification);
        }
        return assertFound(this.findOne(ctx, order.id));
    }

    /**
     * @description
     * Settles a payment by invoking the {@link PaymentMethodHandler}'s `settlePayment()` method. Automatically
     * transitions the Order state if all Payments are settled.
     */
    async settlePayment(
        ctx: RequestContext,
        paymentId: ID,
    ): Promise<ErrorResultUnion<SettlePaymentResult, Payment>> {
        const payment = await this.paymentService.settlePayment(ctx, paymentId);
        if (!isGraphQlErrorResult(payment)) {
            if (payment.state !== 'Settled') {
                return new SettlePaymentError({ paymentErrorMessage: payment.errorMessage || '' });
            }
        }
        return payment;
    }

    /**
     * @description
     * Cancels a payment by invoking the {@link PaymentMethodHandler}'s `cancelPayment()` method (if defined), and transitions the Payment to
     * the `Cancelled` state.
     */
    async cancelPayment(
        ctx: RequestContext,
        paymentId: ID,
    ): Promise<ErrorResultUnion<CancelPaymentResult, Payment>> {
        const payment = await this.paymentService.cancelPayment(ctx, paymentId);
        if (!isGraphQlErrorResult(payment)) {
            if (payment.state !== 'Cancelled') {
                return new CancelPaymentError({ paymentErrorMessage: payment.errorMessage || '' });
            }
        }
        return payment;
    }

    /**
     * @description
     * Creates a new Fulfillment associated with the given Order and OrderItems.
     */
    async createFulfillment(
        ctx: RequestContext,
        input: FulfillOrderInput,
    ): Promise<ErrorResultUnion<AddFulfillmentToOrderResult, Fulfillment>> {
        if (!input.lines || input.lines.length === 0 || summate(input.lines, 'quantity') === 0) {
            return new EmptyOrderLineSelectionError();
        }
        const orders = await getOrdersFromLines(ctx, this.connection, input.lines);

        if (await this.requestedFulfillmentQuantityExceedsLineQuantity(ctx, input)) {
            return new ItemsAlreadyFulfilledError();
        }

        const stockCheckResult = await this.ensureSufficientStockForFulfillment(ctx, input);
        if (isGraphQlErrorResult(stockCheckResult)) {
            return stockCheckResult;
        }

        const fulfillment = await this.fulfillmentService.create(ctx, orders, input.lines, input.handler);
        if (isGraphQlErrorResult(fulfillment)) {
            return fulfillment;
        }

        await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder()
            .relation('fulfillments')
            .of(orders)
            .add(fulfillment);

        for (const order of orders) {
            await this.historyService.createHistoryEntryForOrder({
                ctx,
                orderId: order.id,
                type: HistoryEntryType.ORDER_FULFILLMENT,
                data: {
                    fulfillmentId: fulfillment.id,
                },
            });
        }
        const result = await this.fulfillmentService.transitionToState(ctx, fulfillment.id, 'Pending');
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        return result.fulfillment;
    }

    private async requestedFulfillmentQuantityExceedsLineQuantity(
        ctx: RequestContext,
        input: FulfillOrderInput,
    ) {
        const existingFulfillmentLines = await this.connection
            .getRepository(ctx, FulfillmentLine)
            .createQueryBuilder('fulfillmentLine')
            .leftJoinAndSelect('fulfillmentLine.orderLine', 'orderLine')
            .leftJoinAndSelect('fulfillmentLine.fulfillment', 'fulfillment')
            .where('fulfillmentLine.orderLineId IN (:...orderLineIds)', {
                orderLineIds: input.lines.map(l => l.orderLineId),
            })
            .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
            .getMany();

        for (const inputLine of input.lines) {
            const fulfillmentLinesForOrderLine = existingFulfillmentLines.filter(l =>
                idsAreEqual(l.orderLineId, inputLine.orderLineId),
            );
            if (fulfillmentLinesForOrderLine.length) {
                const fulfilledQuantity = summate(fulfillmentLinesForOrderLine, 'quantity');
                const unfulfilledQuantity =
                    fulfillmentLinesForOrderLine[0].orderLine.quantity - fulfilledQuantity;
                if (unfulfilledQuantity < inputLine.quantity) {
                    return true;
                }
            } else {
                const orderLine = await this.connection.getEntityOrThrow(
                    ctx,
                    OrderLine,
                    inputLine.orderLineId,
                );
                if (orderLine.quantity < inputLine.quantity) {
                    return true;
                }
            }
        }
        return false;
    }

    private async ensureSufficientStockForFulfillment(
        ctx: RequestContext,
        input: FulfillOrderInput,
    ): Promise<InsufficientStockOnHandError | undefined> {
        const lines = await this.connection.getRepository(ctx, OrderLine).find({
            where: {
                id: In(input.lines.map(l => l.orderLineId)),
            },
            relations: ['productVariant'],
        });

        for (const line of lines) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const lineInput = input.lines.find(l => idsAreEqual(l.orderLineId, line.id))!;

            const fulfillableStockLevel = await this.productVariantService.getFulfillableStockLevel(
                ctx,
                line.productVariant,
            );
            if (fulfillableStockLevel < lineInput.quantity) {
                const { stockOnHand } = await this.stockLevelService.getAvailableStock(
                    ctx,
                    line.productVariant.id,
                );
                const productVariant = this.translator.translate(line.productVariant, ctx);
                return new InsufficientStockOnHandError({
                    productVariantId: productVariant.id as string,
                    productVariantName: productVariant.name,
                    stockOnHand,
                });
            }
        }
    }

    /**
     * @description
     * Returns an array of all Fulfillments associated with the Order.
     */
    async getOrderFulfillments(ctx: RequestContext, order: Order): Promise<Fulfillment[]> {
        const { fulfillments } = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['fulfillments'],
        });

        return fulfillments;
    }

    /**
     * @description
     * Returns an array of all Surcharges associated with the Order.
     */
    async getOrderSurcharges(ctx: RequestContext, orderId: ID): Promise<Surcharge[]> {
        const order = await this.connection.getEntityOrThrow(ctx, Order, orderId, {
            channelId: ctx.channelId,
            relations: ['surcharges'],
            relationLoadStrategy: 'query',
        });
        return order.surcharges || [];
    }

    /**
     * @description
     * Cancels an Order by transitioning it to the `Cancelled` state. If stock is being tracked for the ProductVariants
     * in the Order, then new {@link StockMovement}s will be created to correct the stock levels.
     */
    async cancelOrder(
        ctx: RequestContext,
        input: CancelOrderInput,
    ): Promise<ErrorResultUnion<CancelOrderResult, Order>> {
        let allOrderItemsCancelled = false;
        const cancelResult =
            input.lines != null
                ? await this.orderModifier.cancelOrderByOrderLines(ctx, input, input.lines)
                : await this.cancelOrderById(ctx, input);

        if (isGraphQlErrorResult(cancelResult)) {
            return cancelResult;
        } else {
            allOrderItemsCancelled = cancelResult;
        }

        if (allOrderItemsCancelled) {
            const transitionResult = await this.transitionToState(ctx, input.orderId, 'Cancelled');
            if (isGraphQlErrorResult(transitionResult)) {
                return transitionResult;
            }
        }
        return assertFound(this.findOne(ctx, input.orderId));
    }

    private async cancelOrderById(ctx: RequestContext, input: CancelOrderInput) {
        const order = await this.getOrderOrThrow(ctx, input.orderId);
        if (order.active) {
            return true;
        } else {
            const lines: OrderLineInput[] = order.lines.map(l => ({
                orderLineId: l.id,
                quantity: l.quantity,
            }));
            return this.orderModifier.cancelOrderByOrderLines(ctx, input, lines);
        }
    }

    /**
     * @description
     * Creates a {@link Refund} against the order and in doing so invokes the `createRefund()` method of the
     * {@link PaymentMethodHandler}.
     */
    async refundOrder(
        ctx: RequestContext,
        input: RefundOrderInput,
    ): Promise<ErrorResultUnion<RefundOrderResult, Refund>> {
        if (
            (!input.lines || input.lines.length === 0 || summate(input.lines, 'quantity') === 0) &&
            input.shipping === 0 &&
            !input.amount
        ) {
            return new NothingToRefundError();
        }
        const orders = await getOrdersFromLines(ctx, this.connection, input.lines ?? []);
        if (1 < orders.length) {
            return new MultipleOrderError();
        }
        const payment = await this.connection.getEntityOrThrow(ctx, Payment, input.paymentId, {
            relations: ['order'],
        });
        if (orders && orders.length && !idsAreEqual(payment.order.id, orders[0].id)) {
            return new PaymentOrderMismatchError();
        }
        const order = payment.order;
        if (
            order.state === 'AddingItems' ||
            order.state === 'ArrangingPayment' ||
            order.state === 'PaymentAuthorized'
        ) {
            return new RefundOrderStateError({ orderState: order.state });
        }

        const createdRefund = await this.paymentService.createRefund(ctx, input, order, payment);

        if (createdRefund instanceof Refund) {
            await this.eventBus.publish(new RefundEvent(ctx, order, createdRefund, 'created'));
        }
        return createdRefund;
    }

    /**
     * @description
     * Settles a Refund by transitioning it to the `Settled` state.
     */
    async settleRefund(ctx: RequestContext, input: SettleRefundInput): Promise<Refund> {
        const refund = await this.connection.getEntityOrThrow(ctx, Refund, input.id, {
            relations: ['payment', 'payment.order'],
        });
        refund.transactionId = input.transactionId;
        const fromState = refund.state;
        const toState = 'Settled';
        const { finalize } = await this.refundStateMachine.transition(
            ctx,
            refund.payment.order,
            refund,
            toState,
        );
        await this.connection.getRepository(ctx, Refund).save(refund);
        await finalize();
        await this.eventBus.publish(
            new RefundStateTransitionEvent(fromState, toState, ctx, refund, refund.payment.order),
        );
        return refund;
    }

    /**
     * @description
     * Associates a Customer with the Order.
     */
    async addCustomerToOrder(
        ctx: RequestContext,
        orderIdOrOrder: ID | Order,
        customer: Customer,
    ): Promise<Order> {
        const order =
            orderIdOrOrder instanceof Order
                ? orderIdOrOrder
                : await this.getOrderOrThrow(ctx, orderIdOrOrder);
        order.customer = customer;
        await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        let updatedOrder = order;
        // Check that any applied couponCodes are still valid now that
        // we know the Customer.
        if (order.active && order.couponCodes) {
            for (const couponCode of order.couponCodes.slice()) {
                const validationResult = await this.promotionService.validateCouponCode(
                    ctx,
                    couponCode,
                    customer.id,
                );
                if (isGraphQlErrorResult(validationResult)) {
                    updatedOrder = await this.removeCouponCode(ctx, order.id, couponCode);
                }
            }
        }
        return updatedOrder;
    }

    /**
     * @description
     * Creates a new "ORDER_NOTE" type {@link OrderHistoryEntry} in the Order's history timeline.
     */
    async addNoteToOrder(ctx: RequestContext, input: AddNoteToOrderInput): Promise<Order> {
        const order = await this.getOrderOrThrow(ctx, input.id);
        await this.historyService.createHistoryEntryForOrder(
            {
                ctx,
                orderId: order.id,
                type: HistoryEntryType.ORDER_NOTE,
                data: {
                    note: input.note,
                },
            },
            input.isPublic,
        );
        return order;
    }

    async updateOrderNote(ctx: RequestContext, input: UpdateOrderNoteInput): Promise<HistoryEntry> {
        return this.historyService.updateOrderHistoryEntry(ctx, {
            type: HistoryEntryType.ORDER_NOTE,
            data: input.note ? { note: input.note } : undefined,
            isPublic: input.isPublic ?? undefined,
            ctx,
            entryId: input.noteId,
        });
    }

    async deleteOrderNote(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        try {
            await this.historyService.deleteOrderHistoryEntry(ctx, id);
            return {
                result: DeletionResult.DELETED,
            };
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.message,
            };
        }
    }

    /**
     * @description
     * Deletes an Order, ensuring that any Sessions that reference this Order are dereferenced before deletion.
     *
     * @since 1.5.0
     */
    async deleteOrder(ctx: RequestContext, orderOrId: ID | Order) {
        const orderToDelete =
            orderOrId instanceof Order
                ? orderOrId
                : await this.connection
                      .getRepository(ctx, Order)
                      .findOneOrFail({ where: { id: orderOrId }, relations: ['lines', 'shippingLines'] });
        // If there is a Session referencing the Order to be deleted, we must first remove that
        // reference in order to avoid a foreign key error. See https://github.com/vendurehq/vendure/issues/1454
        const sessions = await this.connection
            .getRepository(ctx, Session)
            .find({ where: { activeOrderId: orderToDelete.id } });
        if (sessions.length) {
            await this.connection
                .getRepository(ctx, Session)
                .update(sessions.map(s => s.id) as string[], { activeOrder: null });
        }
        const deletedOrder = new Order(orderToDelete);
        await this.connection.getRepository(ctx, Order).delete(orderToDelete.id);
        await this.eventBus.publish(new OrderEvent(ctx, deletedOrder, 'deleted'));
    }

    /**
     * @description
     * When a guest user with an anonymous Order signs in and has an existing Order associated with that Customer,
     * we need to reconcile the contents of the two orders.
     *
     * The logic used to do the merging is specified in the {@link OrderOptions} `mergeStrategy` config setting.
     */
    async mergeOrders(
        ctx: RequestContext,
        user: User,
        guestOrder?: Order,
        existingOrder?: Order,
    ): Promise<Order | undefined> {
        if (guestOrder && guestOrder.customer) {
            // In this case the "guest order" is actually an order of an existing Customer,
            // so we do not want to merge at all. See https://github.com/vendurehq/vendure/issues/263
            return existingOrder;
        }
        const mergeResult = this.orderMerger.merge(ctx, guestOrder, existingOrder);
        const { orderToDelete, linesToInsert, linesToDelete, linesToModify } = mergeResult;
        let { order } = mergeResult;
        if (orderToDelete) {
            try {
                // Separate transaction to isolate foreign key failure, so it doesn't roll back the entire outer transaction
                await this.connection.withTransaction(ctx, async innerCtx => {
                    await this.deleteOrder(innerCtx, orderToDelete);
                });
            } catch (e: any) {
                if (!isForeignKeyViolationError(e)) throw e;
                if (!order)
                    throw new Error(
                        `Cannot complete order merge: active order not found, while cancelling order ${orderToDelete.id}`,
                    );

                // If the order has a foreign key violation (e.g. with cancelled payments),
                // instead of deleting it we cancel the order and leave a note with an explanation.
                // This way the previous order and all its information are preserved.
                await this.cancelOrder(ctx, { orderId: orderToDelete.id });

                const note = [
                    'This order was cancelled during user sign-in because merging with the active order was not possible.',
                    `The active order is ${order.code}. This order has been preserved for reference.`,
                ].join(' ');

                await this.historyService.createHistoryEntryForOrder(
                    {
                        ctx,
                        orderId: orderToDelete.id,
                        type: HistoryEntryType.ORDER_NOTE,
                        data: { note },
                    },
                    false,
                );
            }
        }
        if (order && linesToDelete) {
            const orderId = order.id;
            for (const line of linesToDelete) {
                const result = await this.removeItemFromOrder(ctx, orderId, line.orderLineId);
                if (!isGraphQlErrorResult(result)) {
                    order = result;
                }
            }
        }
        if (order && linesToInsert) {
            const orderId = order.id;
            const result = await this.addItemsToOrder(ctx, orderId, linesToInsert);
            order = result.order;
        }
        if (order && linesToModify) {
            const orderId = order.id;
            const result = await this.adjustOrderLines(ctx, orderId, linesToModify);
            order = result.order;
        }
        if (order && linesToDelete) {
            const orderId = order.id;
            try {
                const result = await this.removeItemsFromOrder(
                    ctx,
                    orderId,
                    linesToDelete.map(l => l.orderLineId),
                );
                if (!isGraphQlErrorResult(result)) {
                    order = result;
                }
            } catch (e: any) {
                Logger.error(e.message, undefined, e.stack);
            }
        }
        const customer = await this.customerService.findOneByUserId(ctx, user.id);
        if (order && customer) {
            order.customer = customer;
            await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        }
        return order;
    }

    private async getOrderOrThrow(
        ctx: RequestContext,
        orderId: ID,
        relations?: RelationPaths<Order>,
    ): Promise<Order> {
        const order = await this.findOne(
            ctx,
            orderId,
            relations ?? [
                'lines',
                'lines.productVariant',
                'lines.productVariant.productVariantPrices',
                'shippingLines',
                'surcharges',
                'customer',
            ],
        );
        if (!order) {
            throw new EntityNotFoundError('Order', orderId);
        }
        return order;
    }

    private getOrderLineOrThrow(order: Order, orderLineId: ID): OrderLine {
        const orderLine = order.lines.find(line => idsAreEqual(line.id, orderLineId));
        if (!orderLine) {
            throw new UserInputError('error.order-does-not-contain-line-with-id', { id: orderLineId });
        }
        return orderLine;
    }

    /**
     * Returns error if quantity is negative.
     */
    private assertQuantityIsPositive(quantity: number) {
        if (quantity < 0) {
            return new NegativeQuantityError();
        }
    }

    /**
     * Returns error if the Order is not in the "AddingItems" or "Draft" state.
     */
    private assertAddingItemsState(order: Order) {
        if (order.state !== 'AddingItems' && order.state !== 'Draft') {
            return new OrderModificationError();
        }
    }

    /**
     * Throws if adding the given quantity would take the total order items over the
     * maximum limit specified in the config.
     */
    private assertNotOverOrderItemsLimit(order: Order, quantityToAdd: number) {
        const currentItemsCount = summate(order.lines, 'quantity');
        const { orderItemsLimit } = this.configService.orderOptions;
        if (orderItemsLimit < currentItemsCount + quantityToAdd) {
            return new OrderLimitError({ maxItems: orderItemsLimit });
        }
    }

    /**
     * Throws if adding the given quantity would exceed the maximum allowed
     * quantity for one order line.
     */
    private assertNotOverOrderLineItemsLimit(orderLine: OrderLine | undefined, quantityToAdd: number) {
        const currentQuantity = orderLine?.quantity || 0;
        const { orderLineItemsLimit } = this.configService.orderOptions;
        if (orderLineItemsLimit < currentQuantity + quantityToAdd) {
            return new OrderLimitError({ maxItems: orderLineItemsLimit });
        }
    }

    /**
     * @description
     * Applies promotions, taxes and shipping to the Order. If the `updatedOrderLines` argument is passed in,
     * then all of those OrderLines will have their prices re-calculated using the configured {@link OrderItemPriceCalculationStrategy}.
     */
    async applyPriceAdjustments(
        ctx: RequestContext,
        order: Order,
        updatedOrderLines?: OrderLine[],
        relations?: RelationPaths<Order>,
    ): Promise<Order> {
        const promotions = await this.promotionService.getActivePromotionsInChannel(ctx);
        const activePromotionsPre = await this.promotionService.getActivePromotionsOnOrder(ctx, order.id);

        // When changing the Order's currencyCode (on account of passing
        // a different currencyCode into the RequestContext), we need to make sure
        // to update all existing OrderLines to use prices in this new currency.
        if (ctx.currencyCode !== order.currencyCode) {
            updatedOrderLines = order.lines;
            order.currencyCode = ctx.currencyCode;
        }

        if (updatedOrderLines?.length) {
            const { orderItemPriceCalculationStrategy, changedPriceHandlingStrategy } =
                this.configService.orderOptions;
            for (const updatedOrderLine of updatedOrderLines) {
                const variant = await this.productVariantService.applyChannelPriceAndTax(
                    updatedOrderLine.productVariant,
                    ctx,
                    order,
                );
                let priceResult = await orderItemPriceCalculationStrategy.calculateUnitPrice(
                    ctx,
                    variant,
                    updatedOrderLine.customFields || {},
                    order,
                    updatedOrderLine.quantity,
                );
                const initialListPrice = updatedOrderLine.initialListPrice ?? priceResult.price;
                if (initialListPrice !== priceResult.price) {
                    priceResult = await changedPriceHandlingStrategy.handlePriceChange(
                        ctx,
                        priceResult,
                        updatedOrderLine,
                        order,
                    );
                }

                if (updatedOrderLine.initialListPrice == null) {
                    updatedOrderLine.initialListPrice = initialListPrice;
                }
                updatedOrderLine.listPrice = priceResult.price;
                updatedOrderLine.listPriceIncludesTax = priceResult.priceIncludesTax;
            }
        }

        // Get the shipping line IDs before doing the order calculation
        // step, which can in some cases change the applied shipping lines.
        const shippingLineIdsPre = order.shippingLines.map(l => l.id);

        const updatedOrder = await this.orderCalculator.applyPriceAdjustments(
            ctx,
            order,
            promotions,
            updatedOrderLines ?? [],
        );

        const shippingLineIdsPost = updatedOrder.shippingLines.map(l => l.id);
        await this.applyChangesToShippingLines(ctx, updatedOrder, shippingLineIdsPre, shippingLineIdsPost);

        // Explicitly omit the shippingAddress and billingAddress properties to avoid
        // a race condition where changing one or the other in parallel can
        // overwrite the other's changes. The other omissions prevent the save
        // function from doing more work than necessary.
        await this.connection
            .getRepository(ctx, Order)
            .save(
                omit(updatedOrder, [
                    'shippingAddress',
                    'billingAddress',
                    'lines',
                    'shippingLines',
                    'aggregateOrder',
                    'sellerOrders',
                    'customer',
                    'modifications',
                    'customFields',
                ]),
                {
                    reload: false,
                },
            );
        await this.connection.getRepository(ctx, OrderLine).save(updatedOrder.lines, { reload: false });
        await this.connection.getRepository(ctx, ShippingLine).save(order.shippingLines, { reload: false });
        await this.promotionService.runPromotionSideEffects(ctx, order, activePromotionsPre);

        return assertFound(this.findOne(ctx, order.id, relations));
    }

    /**
     * Applies changes to the shipping lines of an order, adding or removing the relations
     * in the database.
     */
    private async applyChangesToShippingLines(
        ctx: RequestContext,
        order: Order,
        shippingLineIdsPre: ID[],
        shippingLineIdsPost: ID[],
    ) {
        const removedShippingLineIds = shippingLineIdsPre.filter(id => !shippingLineIdsPost.includes(id));
        const newlyAddedShippingLineIds = shippingLineIdsPost.filter(id => !shippingLineIdsPre.includes(id));

        for (const idToRemove of removedShippingLineIds) {
            await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder()
                .relation('shippingLines')
                .of(order)
                .remove(idToRemove);
        }

        for (const idToAdd of newlyAddedShippingLineIds) {
            await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder()
                .relation('shippingLines')
                .of(order)
                .add(idToAdd);
        }
    }
}
