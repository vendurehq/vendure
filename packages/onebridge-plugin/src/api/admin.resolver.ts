import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission } from '@vendure/core';

import { OnebridgePermissions } from '../permissions';
import {
    OnebridgeContentService,
    OnebridgeCustomsService,
    OnebridgeInspectionService,
    OnebridgeOrderSummaryService,
    OnebridgeRfqService,
} from '../services';

const RfqManage = OnebridgePermissions.RfqManage as Permission;
const ContentManage = OnebridgePermissions.ContentManage as Permission;
const InspectionManage = OnebridgePermissions.InspectionManage as Permission;
const CustomsManage = OnebridgePermissions.CustomsManage as Permission;

@Resolver()
export class OnebridgeAdminResolver {
    constructor(
        private rfqService: OnebridgeRfqService,
        private contentService: OnebridgeContentService,
        private inspectionService: OnebridgeInspectionService,
        private customsService: OnebridgeCustomsService,
        private orderSummaryService: OnebridgeOrderSummaryService,
    ) {}

    // ===== RFQ =====

    @Query()
    @Allow(RfqManage)
    onebridgeRfqs(@Ctx() ctx: any, @Args('options') options: any) {
        return this.rfqService.adminList(ctx, options);
    }

    @Query()
    @Allow(RfqManage)
    onebridgeRfq(@Ctx() ctx: any, @Args() args: any) {
        return this.rfqService.adminFind(ctx, args.id, args.code);
    }

    @Mutation()
    @Allow(RfqManage)
    saveRfqQuote(@Ctx() ctx: any, @Args('rfqId') rfqId: string, @Args('input') input: any) {
        return this.rfqService.saveQuote(ctx, rfqId, input);
    }

    @Mutation()
    @Allow(RfqManage)
    saveRfqSample(@Ctx() ctx: any, @Args('rfqId') rfqId: string, @Args('input') input: any) {
        return this.rfqService.saveSample(ctx, rfqId, input);
    }

    @Mutation()
    @Allow(RfqManage)
    transitionRfqStage(@Ctx() ctx: any, @Args() args: any) {
        return this.rfqService.transitionStage(ctx, args.rfqId, args.stage, {
            title: args.title,
            desc: args.desc,
            idempotencyKey: args.idempotencyKey,
        });
    }

    // ===== 内容 =====

    @Query()
    @Allow(ContentManage)
    onebridgeContentEntries(@Ctx() ctx: any, @Args('options') options: any) {
        return this.contentService.adminList(ctx, options);
    }

    @Mutation()
    @Allow(ContentManage)
    saveOnebridgeContentEntry(@Ctx() ctx: any, @Args('input') input: any) {
        return this.contentService.save(ctx, input);
    }

    @Mutation()
    @Allow(ContentManage)
    deleteOnebridgeContentEntry(@Ctx() ctx: any, @Args('id') id: string) {
        return this.contentService.delete(ctx, id);
    }

    // ===== 验货 =====

    @Query()
    @Allow(InspectionManage)
    onebridgeInspectionReports(@Ctx() ctx: any, @Args('options') options: any) {
        return this.inspectionService.adminList(ctx, options);
    }

    @Mutation()
    @Allow(InspectionManage)
    createOnebridgeInspectionReport(@Ctx() ctx: any, @Args('input') input: any) {
        return this.inspectionService.create(ctx, input);
    }

    @Mutation()
    @Allow(InspectionManage)
    publishOnebridgeInspectionReport(@Ctx() ctx: any, @Args('id') id: string) {
        return this.inspectionService.publish(ctx, id);
    }

    // ===== 清关 =====

    @Query()
    @Allow(CustomsManage)
    onebridgeCustomsRecord(@Ctx() ctx: any, @Args('orderCode') orderCode: string) {
        return this.customsService.findByOrderCode(ctx, orderCode);
    }

    @Query()
    @Allow(CustomsManage)
    onebridgeCustomsRecords(@Ctx() ctx: any, @Args('options') options: any) {
        return this.customsService.adminList(ctx, options);
    }

    @Mutation()
    @Allow(CustomsManage)
    upsertOnebridgeCustomsRecord(@Ctx() ctx: any, @Args('input') input: any) {
        return this.customsService.upsert(ctx, input);
    }

    // ===== 订单聚合 =====

    @Query()
    @Allow(Permission.ReadOrder)
    onebridgeOrderSummary(@Ctx() ctx: any, @Args('orderCode') orderCode: string) {
        return this.orderSummaryService.summary(ctx, orderCode, false);
    }
}
