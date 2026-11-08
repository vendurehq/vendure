import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';
import { R2MarkService } from './r2-mark.service';
import { HallService } from './hall.service';
import { RiderTaskService } from './rider-task.service';

@Resolver()
export class RiderTaskShopResolver {
    constructor(
        private riderTaskService: RiderTaskService,
        private r2Mark: R2MarkService,
        private hall: HallService,
    ) {}

    /** 需登录骑手：service 内部 assertApprovedRider，未登录/未批准/信用分不足抛 ForbiddenError。 */
    @Query()
    @Allow(Permission.Authenticated)
    async campusMyTasks(@Ctx() ctx: RequestContext, @Args('status', { nullable: true }) status?: string) {
        return this.riderTaskService.myTasks(ctx, status);
    }

    /** 骑手侧顾客联系方式（号码保护）：仅本单骑手可查，返回 display/callable 而非真实号 */
    @Query()
    @Allow(Permission.Authenticated)
    async campusRiderCustomerContact(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.riderTaskService.customerContact(ctx, orderId);
    }

    /** 需登录：仅下单人本人可查（service 内归属校验） */
    @Query()
    @Allow(Permission.Authenticated)
    async campusOrderRider(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.riderTaskService.orderRider(ctx, orderId);
    }

    /** 交接码：仅本单骑手可查（R1/R2 第二段起送必填），未指派/已送达返回 null */
    @Query()
    @Allow(Permission.Authenticated)
    async campusTaskHandoverCode(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.riderTaskService.handoverCode(ctx, orderId);
    }

    /** 开始配送：接力单（R1/R2）需传交接码，service 内校验。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusStartTask(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('code', { nullable: true }) code?: string,
    ) {
        return this.riderTaskService.start(ctx, orderId, code);
    }

    /** 转单回大厅；已取货必须拍照交接。错误语义：未登录/非本人 ForbiddenError，状态/缺照片 UserInputError。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusTransferTask(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('photos') photos: string[],
        @Args('note', { nullable: true }) note?: string,
    ) {
        return this.riderTaskService.transfer(ctx, orderId, photos, note);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async campusDeliverTask(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('photos') photos: string[],
        @Args('note', { nullable: true }) note?: string,
    ) {
        return this.riderTaskService.deliver(ctx, orderId, photos, note);
    }

    /** 骑手位置上报（配送中 10s 一次）：本人 + assigned/in_progress 才写，送达/转单由 service 清除。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusRiderReportLocation(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('lat') lat: number,
        @Args('lng') lng: number,
    ) {
        return this.riderTaskService.reportLocation(ctx, orderId, lat, lng);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async campusReportException(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: ID,
        @Args('type') type: string,
        @Args('photos') photos: string[],
        @Args('note', { nullable: true }) note?: string,
    ) {
        return this.riderTaskService.reportException(ctx, orderId, type, photos, note);
    }

    /** R2 快递单到校确认：本人 + fulfillmentRoute='R2'，service 内校验，违规抛 Forbidden/UserInputError。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusMarkArrived(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.r2Mark.markArrived(ctx, orderId);
    }

    /** R5 顾客侧重发交接码：订单归属校验在 service，仅待交接订单可重发（同单 10 分钟限流）。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusResendHandoverCode(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.hall.resendHandoverCodeForCustomer(ctx, Number(orderId));
    }

    /** A3 骑手侧重发交接码：仅本单骑手、已派单未取餐可重发（同单 3 分钟限频）。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusRiderResendHandoverCode(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.riderTaskService.resendHandoverCode(ctx, orderId);
    }

    /** 用户催单（plan 2.4）：状态/频率校验在 service，标记 urged=true + urgedAt。 */
    @Mutation()
    @Allow(Permission.Authenticated)
    async campusUrgeOrder(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.riderTaskService.urgeOrder(ctx, orderId);
    }
}
