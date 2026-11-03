import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { DeliveryGatewayService } from './delivery-gateway.service';
import { DeliveryOrder } from './delivery-order.entity';

@Resolver()
export class MockAdminResolver {
    constructor(private deliveryGateway: DeliveryGatewayService) {}

    @Mutation()
    @Allow(Permission.UpdateOrder)
    async createDelivery(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<any> {
        const delivery = await this.deliveryGateway.createDelivery(ctx, input);
        return this.toGraphQl(delivery);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async deliveryOrders(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: string,
    ): Promise<any[]> {
        const list = await this.deliveryGateway.findByOrder(ctx, orderId as any);
        return list.map(d => this.toGraphQl(d));
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    async mockDeliveryEvent(
        @Ctx() ctx: RequestContext,
        @Args('deliveryOrderNo') deliveryOrderNo: string,
        @Args('status') status: string,
        @Args('courierName', { nullable: true }) courierName?: string,
        @Args('courierPhone', { nullable: true }) courierPhone?: string,
        @Args('reason', { nullable: true }) reason?: string,
    ): Promise<boolean> {
        await this.deliveryGateway.applyStatusEvent(ctx, {
            deliveryOrderNo,
            status: status as any,
            courierName,
            courierPhone,
            reason,
        });
        return true;
    }

    private toGraphQl(d: DeliveryOrder): any {
        return {
            id: d.id,
            code: d.code,
            orderId: d.orderId,
            packageId: d.packageId,
            fulfillmentId: d.fulfillmentId,
            providerCode: d.providerCode,
            thirdPartyNo: d.thirdPartyNo,
            status: d.status,
            fee: d.fee,
            etaMinutes: d.etaMinutes,
            courierName: d.courierName,
            courierPhone: d.courierPhone,
            acceptedAt: d.acceptedAt,
            pickupAt: d.pickupAt,
            deliveredAt: d.deliveredAt,
            cancelledAt: d.cancelledAt,
            reason: d.reason,
        };
    }
}
