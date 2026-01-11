import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderResult,
    AddPaymentToOrderResult,
    ApplyCouponCodeResult,
    MutationAddItemsToOrderArgs,
    MutationAddItemToOrderArgs,
    MutationAddPaymentToOrderArgs,
    MutationAdjustOrderLineArgs,
    MutationApplyCouponCodeArgs,
    MutationRemoveOrderLineArgs,
    MutationSetCurrencyCodeForOrderArgs,
    MutationSetCustomerForOrderArgs,
    MutationSetOrderBillingAddressArgs,
    MutationSetOrderCustomFieldsArgs,
    MutationSetOrderShippingAddressArgs,
    MutationSetOrderShippingMethodArgs,
    MutationTransitionOrderToStateArgs,
    PaymentMethodQuote,
    Permission,
    QueryOrderArgs,
    QueryOrderByCodeArgs,
    RemoveOrderItemsResult,
    SetCustomerForOrderResult,
    SetOrderShippingMethodResult,
    ShippingMethodQuote,
    TransitionOrderToStateResult,
    UpdateMultipleOrderItemsResult,
    UpdateOrderItemsResult,
} from '@vendure/common/lib/generated-shop-types';
import { QueryCountriesArgs } from '@vendure/common/lib/generated-types';
import { unique } from '@vendure/common/lib/unique';

import { ErrorResultUnion, isGraphQlErrorResult } from '../../../common/error/error-result';
import { ForbiddenError } from '../../../common/error/errors';
import { NoActiveOrderError } from '../../../common/error/generated-graphql-shop-errors';
import { Translated } from '../../../common/types/locale-types';
import { idsAreEqual } from '../../../common/utils';
import { ACTIVE_ORDER_INPUT_FIELD_NAME, ConfigService, LogLevel } from '../../../config';
import { Country } from '../../../entity';
import { Order } from '../../../entity/order/order.entity';
import { ActiveOrderService, CountryService } from '../../../service';
import { OrderState } from '../../../service/helpers/order-state-machine/order-state';
import { CustomerService } from '../../../service/services/customer.service';
import { OrderService } from '../../../service/services/order.service';
import { SessionService } from '../../../service/services/session.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

type ActiveOrderArgs = { [ACTIVE_ORDER_INPUT_FIELD_NAME]?: any };

@Resolver()
export class ShopOrderResolver {
    constructor(
        private orderService: OrderService,
        private customerService: CustomerService,
        private sessionService: SessionService,
        private countryService: CountryService,
        private activeOrderService: ActiveOrderService,
        private configService: ConfigService,
    ) {}

    @Query()
    availableCountries(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryCountriesArgs,
    ): Promise<Array<Translated<Country>>> {
        return this.countryService.findAllAvailable(ctx);
    }

    @Query()
    @Allow(Permission.Owner)
    async order(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryOrderArgs,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        const requiredRelations: RelationPaths<Order> = ['customer', 'customer.user'];
        const order = await this.orderService.findOne(
            ctx,
            args.id,
            unique([...relations, ...requiredRelations]),
        );
        if (order && ctx.authorizedAsOwnerOnly) {
            const orderUserId = order.customer && order.customer.user && order.customer.user.id;
            if (idsAreEqual(ctx.activeUserId, orderUserId)) {
                return order;
            } else {
                return;
            }
        }
    }

    @Query()
    @Allow(Permission.Owner)
    async activeOrder(
        @Ctx() ctx: RequestContext,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
        @Args() args: ActiveOrderArgs,
    ): Promise<Order | undefined> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.findOne(ctx, sessionOrder.id, relations);
            } else {
                return;
            }
        }
    }

    @Query()
    @Allow(Permission.Owner)
    async orderByCode(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryOrderByCodeArgs,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        if (ctx.authorizedAsOwnerOnly) {
            const requiredRelations: RelationPaths<Order> = ['customer', 'customer.user'];
            const order = await this.orderService.findOneByCode(
                ctx,
                args.code,
                unique([...relations, ...requiredRelations]),
            );

            if (
                order &&
                (await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(ctx, order))
            ) {
                return order;
            }
            // We throw even if the order does not exist, since giving a different response
            // opens the door to an enumeration attack to find valid order codes.
            throw new ForbiddenError(LogLevel.Verbose);
        }
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async setOrderShippingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetOrderShippingAddressArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.setShippingAddress(ctx, sessionOrder.id, args.input);
            }
        }
        return new NoActiveOrderError();
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async setOrderBillingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetOrderBillingAddressArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.setBillingAddress(ctx, sessionOrder.id, args.input);
            }
        }
        return new NoActiveOrderError();
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async unsetOrderShippingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: ActiveOrderArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.unsetShippingAddress(ctx, sessionOrder.id);
            }
        }
        return new NoActiveOrderError();
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async unsetOrderBillingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: ActiveOrderArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.unsetBillingAddress(ctx, sessionOrder.id);
            }
        }
        return new NoActiveOrderError();
    }

    @Query()
    @Allow(Permission.Owner)
    async eligibleShippingMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: ActiveOrderArgs,
    ): Promise<ShippingMethodQuote[]> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.getEligibleShippingMethods(ctx, sessionOrder.id);
            }
        }
        return [];
    }

    @Query()
    @Allow(Permission.Owner)
    async eligiblePaymentMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: ActiveOrderArgs,
    ): Promise<PaymentMethodQuote[]> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.getEligiblePaymentMethods(ctx, sessionOrder.id);
            }
        }
        return [];
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async setOrderShippingMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetOrderShippingMethodArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<SetOrderShippingMethodResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.setShippingMethod(ctx, sessionOrder.id, args.shippingMethodId);
            }
        }
        return new NoActiveOrderError();
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async setOrderCustomFields(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetOrderCustomFieldsArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                return this.orderService.updateCustomFields(ctx, sessionOrder.id, args.input.customFields);
            }
        }
        return new NoActiveOrderError();
    }

    @Transaction()
    @Query()
    @Allow(Permission.Owner)
    async nextOrderStates(
        @Ctx() ctx: RequestContext,
        @Args() args: ActiveOrderArgs,
    ): Promise<readonly string[]> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
                true,
            );
            return this.orderService.getNextOrderStates(sessionOrder);
        }
        return [];
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async transitionOrderToState(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationTransitionOrderToStateArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<TransitionOrderToStateResult, Order> | undefined> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
                true,
            );
            return await this.orderService.transitionToState(ctx, sessionOrder.id, args.state as OrderState);
        }
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async addItemToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddItemToOrderArgs & ActiveOrderArgs,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.addItemToOrder(
            ctx,
            order.id,
            args.productVariantId,
            args.quantity,
            (args as any).customFields,
            relations,
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async addItemsToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddItemsToOrderArgs & ActiveOrderArgs,
    ): Promise<{
        order: Order;
        errorResults: UpdateMultipleOrderItemsResult['errorResults'];
    }> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        const result = await this.orderService.addItemsToOrder(ctx, order.id, args.inputs);
        return {
            order: result.order,
            errorResults: result.errorResults,
        };
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async setCurrencyCodeForOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetCurrencyCodeForOrderArgs & ActiveOrderArgs,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.updateOrderCurrency(ctx, order.id, args.currencyCode, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async adjustOrderLine(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAdjustOrderLineArgs & ActiveOrderArgs,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        if (args.quantity === 0) {
            return this.removeOrderLine(ctx, { orderLineId: args.orderLineId });
        }
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.adjustOrderLine(
            ctx,
            order.id,
            args.orderLineId,
            args.quantity,
            (args as any).customFields,
            relations,
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async removeOrderLine(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveOrderLineArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.removeItemFromOrder(ctx, order.id, args.orderLineId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async removeAllOrderLines(
        @Ctx() ctx: RequestContext,
        @Args() args: ActiveOrderArgs,
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.removeAllItemsFromOrder(ctx, order.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async applyCouponCode(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationApplyCouponCodeArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<ApplyCouponCodeResult, Order>> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.applyCouponCode(ctx, order.id, args.couponCode);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async removeCouponCode(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationApplyCouponCodeArgs & ActiveOrderArgs,
    ): Promise<Order> {
        const order = await this.activeOrderService.getActiveOrder(
            ctx,
            args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            true,
        );
        return this.orderService.removeCouponCode(ctx, order.id, args.couponCode);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async addPaymentToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddPaymentToOrderArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<AddPaymentToOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                const order = await this.orderService.addPaymentToOrder(ctx, sessionOrder.id, args.input);
                if (isGraphQlErrorResult(order)) {
                    return order;
                }
                if (order.active === false) {
                    await this.customerService.createAddressesForNewCustomer(ctx, order);
                }
                if (order.active === false && ctx.session?.activeOrderId === sessionOrder.id) {
                    await this.sessionService.unsetActiveOrder(ctx, ctx.session);
                }
                return order;
            }
        }
        return new NoActiveOrderError();
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async setCustomerForOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetCustomerForOrderArgs & ActiveOrderArgs,
    ): Promise<ErrorResultUnion<SetCustomerForOrderResult, Order>> {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(
                ctx,
                args[ACTIVE_ORDER_INPUT_FIELD_NAME],
            );
            if (sessionOrder) {
                const { guestCheckoutStrategy } = this.configService.orderOptions;
                const result = await guestCheckoutStrategy.setCustomerForOrder(ctx, sessionOrder, args.input);
                if (isGraphQlErrorResult(result)) {
                    return result;
                }
                return this.orderService.addCustomerToOrder(ctx, sessionOrder.id, result);
            }
        }
        return new NoActiveOrderError();
    }
}
