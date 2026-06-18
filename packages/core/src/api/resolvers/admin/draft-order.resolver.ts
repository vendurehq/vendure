import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderResult,
    ApplyCouponCodeResult,
    RemoveOrderItemsResult,
    SetOrderShippingMethodResult,
    UpdateOrderItemsResult,
} from '@vendure/common/lib/generated-shop-types';
import {
    DeletionResponse,
    DeletionResult,
    MutationAddItemToDraftOrderArgs,
    MutationAdjustDraftOrderLineArgs,
    MutationApplyCouponCodeToDraftOrderArgs,
    MutationDeleteDraftOrderArgs,
    MutationRemoveCouponCodeFromDraftOrderArgs,
    MutationRemoveDraftOrderLineArgs,
    MutationSetCustomerForDraftOrderArgs,
    MutationSetDraftOrderBillingAddressArgs,
    MutationSetDraftOrderCustomFieldsArgs,
    MutationSetDraftOrderShippingAddressArgs,
    MutationSetDraftOrderShippingMethodArgs,
    MutationUnsetDraftOrderBillingAddressArgs,
    MutationUnsetDraftOrderShippingAddressArgs,
    Permission,
    QueryEligibleShippingMethodsForDraftOrderArgs,
    ShippingMethodQuote,
} from '@vendure/common/lib/generated-types';

import { ErrorResultUnion, isGraphQlErrorResult } from '../../../common/error/error-result';
import { UserInputError } from '../../../common/error/errors';
import { TransactionalConnection } from '../../../connection/index';
import { Customer } from '../../../entity/customer/customer.entity';
import { Order } from '../../../entity/order/order.entity';
import { CustomerService } from '../../../service/services/customer.service';
import { OrderService } from '../../../service/services/order.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class DraftOrderResolver {
    constructor(
        private orderService: OrderService,
        private customerService: CustomerService,
        private connection: TransactionalConnection,
    ) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async createDraftOrder(@Ctx() ctx: RequestContext): Promise<Order> {
        return this.orderService.createDraft(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteOrder)
    async deleteDraftOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteDraftOrderArgs,
    ): Promise<DeletionResponse> {
        const order = await this.orderService.findOne(ctx, args.orderId);
        if (!order || order.state !== 'Draft') {
            return {
                result: DeletionResult.NOT_DELETED,
                message: `No draft Order with the ID ${args.orderId} was found`,
            };
        }
        try {
            await this.orderService.deleteOrder(ctx, args.orderId);
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

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async addItemToDraftOrder(
        @Ctx() ctx: RequestContext,
        @Args() { orderId, input }: MutationAddItemToDraftOrderArgs,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        return this.orderService.addItemToOrder(
            ctx,
            orderId,
            input.productVariantId,
            input.quantity,
            (input as any).customFields,
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder, Permission.Owner)
    async adjustDraftOrderLine(
        @Ctx() ctx: RequestContext,
        @Args() { orderId, input }: MutationAdjustDraftOrderLineArgs,
    ): Promise<ErrorResultUnion<UpdateOrderItemsResult, Order>> {
        if (input.quantity === 0) {
            return this.removeDraftOrderLine(ctx, { orderId, orderLineId: input.orderLineId });
        }
        return this.orderService.adjustOrderLine(
            ctx,
            orderId,
            input.orderLineId,
            input.quantity,
            (input as any).customFields,
        );
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async removeDraftOrderLine(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveDraftOrderLineArgs,
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        return this.orderService.removeItemFromOrder(ctx, args.orderId, args.orderLineId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async setDraftOrderCustomFields(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetDraftOrderCustomFieldsArgs,
    ): Promise<ErrorResultUnion<RemoveOrderItemsResult, Order>> {
        return this.orderService.updateCustomFields(ctx, args.orderId, args.input.customFields ?? {});
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async setCustomerForDraftOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetCustomerForDraftOrderArgs,
    ): Promise<ErrorResultUnion</* SetCustomerForDraftOrderResult*/ any, Order>> {
        let customer: Customer;
        if (args.customerId) {
            const result = await this.customerService.findOne(ctx, args.customerId);
            if (!result) {
                throw new UserInputError(
                    `No customer with the id "${args.customerId}" was found in this Channel`,
                );
            }
            customer = result;
        } else if (args.input) {
            const result = await this.customerService.createOrUpdate(ctx, args.input, true);
            if (isGraphQlErrorResult(result)) {
                return result as any;
            }
            customer = result;
        } else {
            throw new UserInputError(
                'Either "customerId" or "input" must be supplied to setCustomerForDraftOrder',
            );
        }

        return this.orderService.addCustomerToOrder(ctx, args.orderId, customer);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async setDraftOrderShippingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetDraftOrderShippingAddressArgs,
    ): Promise<Order> {
        return this.orderService.setShippingAddress(ctx, args.orderId, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async setDraftOrderBillingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetDraftOrderBillingAddressArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        return this.orderService.setBillingAddress(ctx, args.orderId, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async unsetDraftOrderShippingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUnsetDraftOrderShippingAddressArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        return this.orderService.unsetShippingAddress(ctx, args.orderId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async unsetDraftOrderBillingAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUnsetDraftOrderBillingAddressArgs,
    ): Promise<ErrorResultUnion<ActiveOrderResult, Order>> {
        return this.orderService.unsetBillingAddress(ctx, args.orderId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async applyCouponCodeToDraftOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationApplyCouponCodeToDraftOrderArgs,
    ): Promise<ErrorResultUnion<ApplyCouponCodeResult, Order>> {
        return this.orderService.applyCouponCode(ctx, args.orderId, args.couponCode);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async removeCouponCodeFromDraftOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveCouponCodeFromDraftOrderArgs,
    ): Promise<Order> {
        return this.orderService.removeCouponCode(ctx, args.orderId, args.couponCode);
    }

    @Query()
    @Allow(Permission.CreateOrder)
    async eligibleShippingMethodsForDraftOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryEligibleShippingMethodsForDraftOrderArgs,
    ): Promise<ShippingMethodQuote[]> {
        return this.orderService.getEligibleShippingMethods(ctx, args.orderId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateOrder)
    async setDraftOrderShippingMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSetDraftOrderShippingMethodArgs,
    ): Promise<ErrorResultUnion<SetOrderShippingMethodResult, Order>> {
        return this.orderService.setShippingMethod(ctx, args.orderId, [args.shippingMethodId]);
    }
}
