import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    AddFulfillmentToOrderResult,
    CancelOrderResult,
    CancelPaymentResult,
    MutationAddFulfillmentToOrderArgs,
    MutationAddManualPaymentToOrderArgs,
    MutationAddNoteToOrderArgs,
    MutationCancelOrderArgs,
    MutationCancelPaymentArgs,
    MutationDeleteOrderNoteArgs,
    MutationModifyOrderArgs,
    MutationRefundOrderArgs,
    MutationSetOrderCustomerArgs,
    MutationSetOrderCustomFieldsArgs,
    MutationSettlePaymentArgs,
    MutationSettleRefundArgs,
    MutationTransitionFulfillmentToStateArgs,
    MutationTransitionOrderToStateArgs,
    MutationTransitionPaymentToStateArgs,
    MutationUpdateOrderNoteArgs,
    Permission,
    QueryOrderArgs,
    QueryOrdersArgs,
    RefundOrderResult,
    SettlePaymentResult,
    TransitionPaymentToStateResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ErrorResultUnion, isGraphQlErrorResult } from '../../../common/error/error-result';
import { TransactionalConnection } from '../../../connection';
import { Fulfillment } from '../../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../../entity/order/order.entity';
import { Payment } from '../../../entity/payment/payment.entity';
import { Refund } from '../../../entity/refund/refund.entity';
import { FulfillmentState } from '../../../service/helpers/fulfillment-state-machine/fulfillment-state';
import { OrderState } from '../../../service/helpers/order-state-machine/order-state';
import { PaymentState } from '../../../service/helpers/payment-state-machine/payment-state';
import { OrderService } from '../../../service/services/order.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class OrderResolver {
    constructor(
        private orderService: OrderService,
        private connection: TransactionalConnection,
    ) {}

    @Query()
    @Allow(Permission.ReadOrder)
    orders(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryOrdersArgs,
        @Relations(Order) relations: RelationPaths<Order>,
    ): Promise<PaginatedList<Order>> {
        return this.orderService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async order(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryOrderArgs,
        @Relations({ entity: Order, omit: ['aggregateOrder', 'sellerOrders'] })
        relations: RelationPaths<Order>,
    ): Promise<Order | undefined> {
        return this.orderService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async settlePayment(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationSettlePaymentArgs,
    ): Promise<ErrorResultUnion<SettlePaymentResult, Payment>> {
        return this.orderService.settlePayment(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async cancelPayment(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCancelPaymentArgs,
    ): Promise<ErrorResultUnion<CancelPaymentResult, Payment>> {
        return this.orderService.cancelPayment(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async addFulfillmentToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddFulfillmentToOrderArgs,
    ): Promise<ErrorResultUnion<AddFulfillmentToOrderResult, Fulfillment>> {
        return this.orderService.createFulfillment(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async cancelOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCancelOrderArgs,
    ): Promise<ErrorResultUnion<CancelOrderResult, Order>> {
        return this.orderService.cancelOrder(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async refundOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRefundOrderArgs,
    ): Promise<ErrorResultUnion<RefundOrderResult, Refund>> {
        return this.orderService.refundOrder(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async settleRefund(@Ctx() ctx: RequestContext, @Args() args: MutationSettleRefundArgs) {
        return this.orderService.settleRefund(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async addNoteToOrder(@Ctx() ctx: RequestContext, @Args() args: MutationAddNoteToOrderArgs) {
        return this.orderService.addNoteToOrder(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async updateOrderNote(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateOrderNoteArgs) {
        return this.orderService.updateOrderNote(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async deleteOrderNote(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteOrderNoteArgs) {
        return this.orderService.deleteOrderNote(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async setOrderCustomFields(@Ctx() ctx: RequestContext, @Args() args: MutationSetOrderCustomFieldsArgs) {
        return this.orderService.updateCustomFields(ctx, args.input.id, args.input.customFields);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async setOrderCustomer(@Ctx() ctx: RequestContext, @Args() { input }: MutationSetOrderCustomerArgs) {
        return this.orderService.updateOrderCustomer(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async transitionOrderToState(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationTransitionOrderToStateArgs,
    ) {
        return this.orderService.transitionToState(ctx, args.id, args.state as OrderState);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async transitionFulfillmentToState(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationTransitionFulfillmentToStateArgs,
    ) {
        return this.orderService.transitionFulfillmentToState(ctx, args.id, args.state as FulfillmentState);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async transitionPaymentToState(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationTransitionPaymentToStateArgs,
    ): Promise<ErrorResultUnion<TransitionPaymentToStateResult, Payment>> {
        return this.orderService.transitionPaymentToState(ctx, args.id, args.state as PaymentState);
    }

    @Transaction('manual')
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async modifyOrder(@Ctx() ctx: RequestContext, @Args() args: MutationModifyOrderArgs) {
        await this.connection.startTransaction(ctx);
        const result = await this.orderService.modifyOrder(ctx, args.input);

        if (args.input.dryRun || isGraphQlErrorResult(result)) {
            await this.connection.rollBackTransaction(ctx);
        } else {
            await this.connection.commitOpenTransaction(ctx);
        }

        return result;
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateOrder)
    async addManualPaymentToOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddManualPaymentToOrderArgs,
    ) {
        return this.orderService.addManualPaymentToOrder(ctx, args.input);
    }
}
