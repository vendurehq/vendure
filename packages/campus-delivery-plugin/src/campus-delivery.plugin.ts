import { OnApplicationBootstrap } from '@nestjs/common';
import {
    EventBus,
    Injector,
    Logger,
    OrderPlacedEvent,
    OrderService,
    OrderStateTransitionEvent,
    PaymentStateTransitionEvent,
    PluginCommonModule,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { ModuleRef } from '@nestjs/core';
import { AfterSalesStateTransitionEvent } from '@vendure/after-sales-plugin';
import { AdminNotifyEvent } from '@vendure/notification-plugin';
import { CampusBuilding } from './campus-building.entity';
import { BlacklistAutoScanJob } from './blacklist-scan.job';
import { CapacityAlertJob } from './capacity-alert.job';
import { CapacityService } from './capacity.service';
import { CampusConfigAdminResolver } from './campus-config-admin.resolver';
import { CampusConfigService } from './campus-config.service';
import { CampusSmsService } from './campus-sms.service';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusZone } from './campus-zone.entity';
import { campusCustomFields } from './custom-fields';
import { DeliverySlot } from './delivery-slot.entity';
import { bindOrderGateConnection, campusOrderGateProcess } from './order-gate.process';
import { CampusRiderAppeal, CampusBlacklist, CampusSupportTicket } from './support.entities';
import { CampusChatConversation, CampusChatMessage } from './chat.entities';
import { ChatService } from './chat.service';
import { ChatAdminResolver } from './chat-admin.resolver';
import { ChatShopResolver } from './chat-shop.resolver';
import { CampusRiderReview, CampusRiderSession, CampusRiderShift } from './rider-ops.entities';
import { P7OpsTablesMigration } from './migrations/p7-ops-tables';
import { P8P0Migration } from './migrations/p8-p0-privacy-food-safety';
import { P8P1PackingFeeMigration } from './migrations/p8-p1-packing-fee';
import { P8P1AddonComboMigration } from './migrations/p8-p1-2-addon-combo';
import { P8P1_4CloudPrintMigration } from './migrations/p8-p1-4-cloud-print-kds';
import { P9P2MpListingMigration } from './migrations/p9-p2-mp-listing';
import { P9P2SearchAssistMigration } from './migrations/p9-p2-search-assist';
import { P9P3AdCampaignMigration } from './migrations/p9-p3-ad-campaign';
import { CampusAdCampaign } from './campus-ad.entity';
import { CampusAdService } from './campus-ad.service';
import { CampusAdAdminResolver, CampusAdShopResolver } from './campus-ad.resolver';
import { CampusLockerStation } from './campus-locker.entity';
import { CampusLockerService } from './campus-locker.service';
import { CampusLockerAdminResolver, CampusLockerShopResolver } from './campus-locker.resolver';
import { P9P4LockerMigration } from './migrations/p9-p4-locker';
import { P9P5RiderComplianceMigration } from './migrations/p9-p5-rider-compliance';
import { P9P6TasteProfileMigration } from './migrations/p9-p6-taste-profile';
import { P9P7DeliveryFeeTiersMigration } from './migrations/p9-p7-delivery-fee-tiers';
import { P10ReviewAlertMigration } from './migrations/p10-review-alert';
import { P11SoldOutAutoRestoreMigration } from './migrations/p11-soldout-auto-restore';
import { P13AutoAcceptMigration } from './migrations/p13-auto-accept';
import { P14ClosureCalendarMigration } from './migrations/p14-closure-calendar';
import { P15SupportTicketAfterSalesMigration } from './migrations/p15-support-ticket-after-sales';
import { P16MerchantUrgeAckMigration } from './migrations/p16-merchant-urge-ack';
import { P23DailyPushMigration } from './migrations/p23-daily-push';
import { P119DailyPushFailMigration } from './migrations/p119-daily-push-fail';
import { AutoAcceptJob } from './auto-accept.job';
import { DailyReportPushJob } from './daily-report-push.job';
import { P12DailyLimitMigration } from './migrations/p12-daily-limit';
import { SoldOutAutoRestoreJob } from './soldout-auto-restore.job';
import { AfterSalesSlaAlertJob } from './after-sales-sla-alert.job';
import { AfterSalesFollowUpRemindJob } from './after-sales-followup-remind.job';
import { RiderComplianceReminderJob } from './rider-compliance-reminder.job';
import { AfterSalesMonthlyPushJob } from './after-sales-monthly-push.job';
import { AfterSalesAutoAssignJob } from './after-sales-auto-assign.job';
import { AfterSalesAutoRuleJob } from './after-sales-auto-rule.job';
import { AfterSalesSlaDeadlineJob } from './after-sales-sla-deadline.job';
import { AfterSalesAnomalyAlertJob } from './after-sales-anomaly-alert.job';
import { TasteProfileShopResolver } from './taste-profile-shop.resolver';
import { CloudPrintService } from './cloud-print.service';
import { CampusPrintJob } from './campus-print-job.entity';
import { bindAddonFeeDeps, campusAddonFeeProcess } from './addon-fee.process';
import { PrivacyNumberService } from './privacy-number.service';
import { AddWithdrawPayoutMigration } from './migrations/add-withdraw-payout';
import { AddRiderLocationMigration } from './migrations/add-rider-location';
import { CampusRiderLocation } from './campus-rider-location.entity';
import { RiderLedgerAdminResolver } from './rider-ledger-admin.resolver';
import { RiderLedgerService } from './rider-ledger.service';
import { RiderOpsService } from './rider-ops.service';
import { SupportAdminResolver } from './support-admin.resolver';
import { CompensationAdminResolver } from './compensation-admin.resolver';
import { SupportService } from './support.service';
import { SupportShopResolver } from './support-shop.resolver';
import { DispatchAdminResolver } from './dispatch-admin.resolver';
import { DispatchAdminService } from './dispatch-admin.service';
import { DispatchJobService } from './dispatch-job.service';
import { DeliveryStatsResolver } from './delivery-stats.resolver';
import { DeliveryStatsService } from './delivery-stats.service';
import { SalesStatsResolver } from './sales-stats.resolver';
import { SalesStatsService } from './sales-stats.service';
import { AddressChangeAdminResolver, AddressChangeShopResolver } from './address-change.resolver';
import { AddressChangeService } from './address-change.service';
import { CampusAddressChange } from './campus-address-change.entity';
import { AddAddressChangePricingMigration } from './migrations/add-address-change-pricing';
import { AddAddressChangeSettleProofMigration } from './migrations/add-address-change-settle-proof';
import { P3DataCleanupMigration } from './migrations/p3-data-cleanup';
import { P4OpsHardeningMigration } from './migrations/p4-ops-hardening';
import { P5TimestampTimezoneMigration } from './migrations/p5-timestamp-timezone';
import { P6DefaultCompensationMigration } from './migrations/p6-default-compensation-and-credit-recovery';
import { ErrandService } from './errand.service';
import { ErrandShopResolver } from './errand-shop.resolver';
import { FavoriteShopResolver } from './favorite-shop.resolver';
import { FeishuCardService } from './feishu/feishu-card.service';
import { FeishuClient } from './feishu/feishu.client';
import { FeishuCommandService } from './feishu/feishu.command.service';
import { FeishuConfigService } from './feishu/feishu.config';
import { FeishuController } from './feishu/feishu.controller';
import { FeishuDigestService } from './feishu/feishu.digest.service';
import { FeishuEventService } from './feishu/feishu.event.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { CampusErrandShippingLineAssignmentStrategy } from './errand-shipping-line-assignment';
import { HallGrabService } from './hall-grab.service';
import { HallService } from './hall.service';
import { HallShopResolver, OrderDeliveryShopResolver } from './hall-shop.resolver';
import { InvoiceShopResolver } from './campus-invoice.resolver';
import { CreateCampusTablesMigration } from './migrations/create-campus-tables';
import { BackfillWaimaiIndustryMigration } from './migrations/backfill-waimai-industry';
import { AddRouteDeliveryConfigMigration } from './migrations/add-route-delivery-config';
import { AddThirdPartyBaseFeeMigration } from './migrations/add-third-party-base-fee';
import { campusCancelGuardProcess } from './cancel-guard.process';
import { bindMinOrderConnection, campusMinOrderProcess } from './min-order.process';
import { bindPackingFeeDeps, campusPackingFeeProcess } from './packing-fee.process';
import { PaymentTimeoutAdminResolver } from './payment-timeout-admin.resolver';
import { PaymentTimeoutAdminService } from './payment-timeout-admin.service';
import { PaymentTimeoutJob } from './payment-timeout.job';
import { PaymentTimeoutTask } from './payment-timeout.entity';
import { CampusPermissions, campusPermissionDefinitions } from './permissions';
import { MerchantAdminResolver } from './merchant-admin.resolver';
import { MerchantAdminService } from './merchant-admin.service';
import { ThirdPartyDeliveryService } from './third-party-delivery.service';
import { CampusNotifyService } from './campus-notify.service';
import { R2MarkService } from './r2-mark.service';
import { R2ShopResolver } from './r2-shop.resolver';
import { R4TagService } from './r4-tag.service';
import { ShippingProfileEnsureService } from './shipping-profile-ensure.service';
import { RiderAdminResolver } from './rider-admin.resolver';
import { RiderCreditLog } from './rider-credit-log.entity';
import { RiderCreditService } from './rider-credit.service';
import { RiderEarning } from './rider-earning.entity';
import { RiderService } from './rider.service';
import { RiderShopResolver } from './rider-shop.resolver';
import { RiderTaskService } from './rider-task.service';
import { RiderTaskShopResolver } from './rider-task-shop.resolver';
import { RiderWalletService } from './rider-wallet.service';
import { RiderWithdrawalRequest } from './rider-withdrawal.entity';
import { bindCampusErrandCalculatorConnection, campusErrandCalculator } from './shipping-calculator';
import { SlotLockService } from './slot-lock.service';
import { WaimaiShopResolver } from './waimai-shop.resolver';
import { WaimaiStoreService } from './waimai-store.service';
import { SearchAssistService } from './search-assist.service';
import { P11TelemetryMigration } from './migrations/p11-telemetry';
import { CampusErrorReport, CampusTrackEvent } from './telemetry.entities';
import { TelemetryAdminResolver, TelemetryShopResolver } from './telemetry.resolver';
import { ResumePaymentShopResolver } from './resume-payment-shop.resolver';
import { TelemetryService } from './telemetry.service';
import { TelemetryRetentionJob } from './telemetry-retention.job';
import { P17AfterSalesNoteMigration } from './migrations/p17-after-sales-note';
import { P18ReplyTemplateMigration } from './migrations/p18-reply-template';
import { P19AfterSalesTagMigration } from './migrations/p19-after-sales-tag';
import { P20AfterSalesAssigneeMigration } from './migrations/p20-after-sales-assignee';
import { P21AfterSalesSlaAlertMigration } from './migrations/p21-after-sales-sla-alert';
import { P22AfterSalesAssignLogMigration } from './migrations/p22-after-sales-assign-log';
import { P23AfterSalesReviewMigration } from './migrations/p23-after-sales-review';
import { P24AfterSalesRiskFollowupMigration } from './migrations/p24-after-sales-risk-followup';
import { P25AfterSalesSlaFollowupMonthlyMigration } from './migrations/p25-after-sales-sla-followup-monthly';
import { P26AfterSalesEscalationAutomationMigration } from './migrations/p26-after-sales-escalation-automation';
import { P27AfterSalesTemplateCategoryMigration } from './migrations/p27-after-sales-template-category';
import { P28AfterSalesProductAndRulesMigration } from './migrations/p28-after-sales-product-and-rules';
import { P29AfterSalesRefundReviewAndSlaMigration } from './migrations/p29-after-sales-refund-review-and-sla';
import { P30AfterSalesAuditDutyCompensationMigration } from './migrations/p30-after-sales-audit-duty-compensation';
import { P31NotifyHandoverFallbackMigration } from './migrations/p31-notify-handover-fallback';
import { P32CampusConfigMissingColumnsMigration } from './migrations/p32-campus-config-missing-columns';
import { P33ChannelWaimaiColumnsMigration } from './migrations/p33-channel-waimai-columns';
import { P34ChannelAfterSalesReviewThresholdMigration } from './migrations/p34-channel-aftersales-review-threshold';
import { P35WithdrawDeductStateMigration } from './migrations/p35-withdraw-deduct-state';
import { P36CompensationTaskMigration } from './migrations/p36-compensation-task';
import { P37SupportTicketSystemMigration } from './migrations/p37-support-ticket-system';
import { P38SupportAssigneeDedupeMigration } from './migrations/p38-support-assignee-dedupe';
import { P39TrustCopyMigration } from './migrations/p39-trust-copy';
import { P40ReviewGiftChoiceMigration } from './migrations/p40-review-gift-choice';
import { P41ReviewGiftChannelColumnsMigration } from './migrations/p41-review-gift-channel-columns';
import { CampusDedupeService } from './campus-dedupe.service';
import { WithdrawReconcileJob } from './withdraw-reconcile.job';
import { CompensationTaskService } from './compensation-task.service';
import { CompensationRetryJob } from './compensation-retry.job';
import { OpsCheckJob } from './ops-check.job';
import { SlotReconcileJob } from './slot-reconcile.job';
import { CampusCompensationTask } from './compensation-task.entity';
import { AfterSalesReviewService } from './after-sales-review.service';
import { AfterSalesReviewAdminResolver, AfterSalesReviewShopResolver } from './after-sales-review.resolver';

// 待付款补偿扫描：原用 Vendure ScheduledTask，但生产为单进程（pm2 只跑 API、无 worker，
// dev-config 配 runTasksInWorkerOnly: true）→ ScheduledTask 从不执行，20 条超时任务曾因此
// 永久 PENDING、订单卡在 ArrangingPayment 11 天。改为 PaymentTimeoutJob 自管定时器
// （与 DispatchJobService / FeishuDigestService 同款部署形态）。

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [CampusZone, CampusBuilding, RiderEarning, CampusFulfillmentConfig, DeliverySlot, RiderCreditLog, RiderWithdrawalRequest, PaymentTimeoutTask, CampusAddressChange, CampusSupportTicket, CampusRiderAppeal, CampusBlacklist, CampusChatConversation, CampusChatMessage, CampusRiderShift, CampusRiderSession, CampusRiderReview, CampusRiderLocation, CampusPrintJob, CampusAdCampaign, CampusLockerStation, CampusTrackEvent, CampusErrorReport, CampusCompensationTask],
    providers: [
        CreateCampusTablesMigration,
        AddRouteDeliveryConfigMigration,
        AddThirdPartyBaseFeeMigration,
        AddAddressChangePricingMigration,
        AddAddressChangeSettleProofMigration,
        P3DataCleanupMigration,
        P4OpsHardeningMigration,
        P5TimestampTimezoneMigration,
        P6DefaultCompensationMigration,
        P7OpsTablesMigration,
        P8P0Migration,
        P8P1PackingFeeMigration,
        P8P1AddonComboMigration,
        P8P1_4CloudPrintMigration,
        P9P2MpListingMigration,
        P9P2SearchAssistMigration,
        P9P3AdCampaignMigration,
        P9P4LockerMigration,
        P9P5RiderComplianceMigration,
        P9P6TasteProfileMigration,
        P9P7DeliveryFeeTiersMigration,
        P10ReviewAlertMigration,
        P11TelemetryMigration,
        P17AfterSalesNoteMigration,
        P18ReplyTemplateMigration,
        P19AfterSalesTagMigration,
        P20AfterSalesAssigneeMigration,
        P21AfterSalesSlaAlertMigration,
        P22AfterSalesAssignLogMigration,
        P23AfterSalesReviewMigration,
        P24AfterSalesRiskFollowupMigration,
        P25AfterSalesSlaFollowupMonthlyMigration,
        P26AfterSalesEscalationAutomationMigration,
        P27AfterSalesTemplateCategoryMigration,
        P28AfterSalesProductAndRulesMigration,
        P29AfterSalesRefundReviewAndSlaMigration,
        P30AfterSalesAuditDutyCompensationMigration,
        P31NotifyHandoverFallbackMigration,
        P32CampusConfigMissingColumnsMigration,
        P33ChannelWaimaiColumnsMigration,
        P34ChannelAfterSalesReviewThresholdMigration,
        P35WithdrawDeductStateMigration,
        P36CompensationTaskMigration,
        P37SupportTicketSystemMigration,
        P38SupportAssigneeDedupeMigration,
        P39TrustCopyMigration,
        P40ReviewGiftChoiceMigration,
        P41ReviewGiftChannelColumnsMigration,
        CampusDedupeService,
        WithdrawReconcileJob,
        CompensationTaskService,
        CompensationRetryJob,
        OpsCheckJob,
        SlotReconcileJob,
        AfterSalesReviewService,
        P11SoldOutAutoRestoreMigration,
        P12DailyLimitMigration,
        P13AutoAcceptMigration,
        P14ClosureCalendarMigration,
        P15SupportTicketAfterSalesMigration,
        P16MerchantUrgeAckMigration,
        P23DailyPushMigration,
        P119DailyPushFailMigration,
        AutoAcceptJob,
        DailyReportPushJob,
        SoldOutAutoRestoreJob,
        AfterSalesSlaAlertJob,
        AfterSalesFollowUpRemindJob,
        RiderComplianceReminderJob,
        AfterSalesMonthlyPushJob,
        AfterSalesAutoAssignJob,
        AfterSalesAutoRuleJob,
        AfterSalesSlaDeadlineJob,
        AfterSalesAnomalyAlertJob,
        AddWithdrawPayoutMigration,
        AddRiderLocationMigration,
        AddressChangeService,
        BackfillWaimaiIndustryMigration,
        CampusConfigService,
        RiderOpsService,
        SupportService,
        ChatService,
        CampusSmsService,
        CapacityAlertJob,
        BlacklistAutoScanJob,
        RiderService,
        CapacityService,
        SlotLockService,
        HallService,
        HallGrabService,
        RiderTaskService,
        RiderCreditService,
        RiderWalletService,
        RiderLedgerService,
        DispatchJobService,
        DispatchAdminService,
        DeliveryStatsService,
        SalesStatsService,
        TelemetryService,
        TelemetryRetentionJob,
        ErrandService,
        R2MarkService,
        R4TagService,
        ShippingProfileEnsureService,
        WaimaiStoreService,
        SearchAssistService,
        CampusAdService,
        CampusLockerService,
        PrivacyNumberService,
        CloudPrintService,
        MerchantAdminService,
        CampusNotifyService,
        ThirdPartyDeliveryService,
        PaymentTimeoutJob,
        PaymentTimeoutAdminService,
        FeishuConfigService,
        FeishuClient,
        FeishuCardService,
        FeishuNotifyService,
        FeishuCommandService,
        FeishuEventService,
        FeishuDigestService,
    ],
    controllers: [FeishuController],
    adminApiExtensions: {
        schema: () => {
            const { gql } = require('graphql-tag');
            return gql`
                type CampusZone {
                    id: ID!
                    name: String!
                    fee: Int!
                    channelId: ID!
                }

                type CampusBuilding {
                    id: ID!
                    name: String!
                    detail: String
                    zoneId: ID!
                    channelId: ID!
                    lat: Float
                    lng: Float
                }

                input CampusBuildingPatchInput {
                    name: String
                    detail: String
                    lat: Float
                    lng: Float
                }

                type CampusFulfillmentConfig {
                    id: ID!
                    channelId: ID!
                    routesEnabled: [String!]!
                    riderCommissionRate: Int!
                    autoAssignMinutes: Int!
                    paused: Boolean!
                    autoRefundMinutes: Int!
                    inProgressSlaMinutes: Int!
                    compensationCouponTemplateId: String
                    merchantConfirmEnabled: Boolean!
                    merchantAutoOpenMinutes: Int!
                    freeShippingThreshold: Int
                    """配送费阶梯（P3-4）JSON：[{minAmount:分, fee:分}]，null=不启用"""
                    deliveryFeeTiers: String
                    timeoutCompensationEnabled: Boolean!
                    timeoutGraceMinutes: Int!
                    """超时赔付回扫窗口（小时，1-168），默认 24"""
                    timeoutCompensationWindowHours: Int!
                    timeoutCompensationCouponTemplateId: String
                    """接单班次校验：开启后骑手仅能在后台登记的排班时段内抢单"""
                    shiftCheckEnabled: Boolean!
                    """自动拉黑阈值：近 30 天顾客主动取消订单达到该次数自动加入黑名单（0=关闭）"""
                    blacklistAutoCancelCount: Int!
                }

                input CampusFulfillmentConfigInput {
                    routesEnabled: [String!]
                    riderCommissionRate: Int
                    autoAssignMinutes: Int
                    paused: Boolean
                    autoRefundMinutes: Int
                    inProgressSlaMinutes: Int
                    compensationCouponTemplateId: String
                    merchantConfirmEnabled: Boolean
                    merchantAutoOpenMinutes: Int
                    """配送费阶梯（P3-4）JSON：[{minAmount:分, fee:分}]，null=不启用"""
                    deliveryFeeTiers: String
                    timeoutCompensationEnabled: Boolean
                    timeoutGraceMinutes: Int
                    timeoutCompensationWindowHours: Int
                    timeoutCompensationCouponTemplateId: String
                    shiftCheckEnabled: Boolean
                    blacklistAutoCancelCount: Int
                }

                type DeliverySlot {
                    id: ID!
                    slotDate: String!
                    startTime: String!
                    endTime: String!
                    zoneId: ID
                    capacity: Int!
                    lockedCount: Int!
                    active: Boolean!
                    channelId: ID!
                }

                input DeliverySlotInput {
                    slotDate: String!
                    startTime: String!
                    endTime: String!
                    zoneId: ID
                    capacity: Int
                }

                input DeliverySlotUpdateInput {
                    startTime: String
                    endTime: String
                    capacity: Int
                    active: Boolean
                }

                type CampusSetRiderStatusResult {
                    status: String!
                }

                type MerchantBoardLine {
                    name: String!
                    quantity: Int!
                    price: Int!
                }

                type MerchantBoardOrder {
                    id: ID!
                    code: String!
                    createdAt: DateTime!
                    total: Int!
                    shipping: Int!
                    building: String!
                    zone: String!
                    slotText: String!
                    route: String!
                    riderName: String
                    note: String
                    printedAt: DateTime
                    provider: String
                    thirdPartyNo: String
                    handoverCode: String
                    """顾客手机号（脱敏，号码保护同口径）；工作台检索/联系用"""
                    customerPhone: String
                    """顾客催单待处理（§78）：顾客催过且商家未「已知晓」"""
                    urged: Boolean!
                    """顾客最近一次催单时间（null=从未催单）"""
                    urgedAt: DateTime
                    lines: [MerchantBoardLine!]!
                }

                """已完成订单明细（§75 对账）：含退款与实收"""
                type CampusMerchantCompletedOrder {
                    id: ID!
                    code: String!
                    """送达时间（对账归时点；历史脏数据可能为 null）"""
                    deliveredAt: DateTime
                    createdAt: DateTime!
                    """订单总额（与工作台「今日完成金额」同口径）"""
                    total: Int!
                    """该单已退金额（排除 Failed 退款单）"""
                    refundAmount: Int!
                    """剩余可退金额（§76）：已支付 − 已退；0 = 已全额退款或未支付"""
                    refundable: Int!
                    """实收 = total - refundAmount"""
                    netAmount: Int!
                    building: String!
                    zone: String!
                    route: String!
                    riderName: String
                    """顾客手机号（脱敏，号码保护同口径）"""
                    customerPhone: String
                    """商品摘要：宫保鸡丁×1、米饭×2"""
                    lineText: String!
                    note: String
                }

                """已完成订单列表 + 区间汇总（§75 对账）"""
                type CampusMerchantCompletedOrders {
                    items: [CampusMerchantCompletedOrder!]!
                    """区间内已完成单量（不受分页影响）"""
                    total: Int!
                    totalAmount: Int!
                    refundAmount: Int!
                    netAmount: Int!
                    """客单价 = 实收 / 单量"""
                    avgTicket: Int!
                    """实际查询区间（回显）"""
                    start: DateTime!
                    end: DateTime!
                }

                """商家发起退款回执（§76）：金额单位分"""
                type CampusMerchantRefundResult {
                    ok: Boolean!
                    """本次退款金额（分）"""
                    amount: Int!
                    """该单累计已退（分，排除 Failed 退款单）"""
                    refundedTotal: Int!
                    """处理后剩余可退（分）"""
                    refundable: Int!
                }

                """退款记录行（§77 台账）：一笔退款单一行"""
                type CampusMerchantRefundRow {
                    id: ID!
                    orderId: ID!
                    """订单号"""
                    code: String!
                    """退款金额（分）"""
                    amount: Int!
                    """退款单状态：Pending/Settled/Failed 等"""
                    state: String!
                    """退款原因（已去掉「merchant refund (单号):」留痕前缀）"""
                    reason: String!
                    """merchant=商家发起 / platform=平台处置"""
                    source: String!
                    createdAt: DateTime!
                    building: String!
                    zone: String!
                }

                """退款记录台账 + 区间汇总（§77）"""
                type CampusMerchantRefunds {
                    items: [CampusMerchantRefundRow!]!
                    """区间退款笔数（排除 Failed）"""
                    count: Int!
                    """区间退款总额（分，排除 Failed）"""
                    amount: Int!
                    """失败笔数 / 金额（留痕排障，不计入退款总额）"""
                    failedCount: Int!
                    failedAmount: Int!
                    """区间退款单总数（含失败，用于分页）"""
                    total: Int!
                    start: DateTime!
                    end: DateTime!
                }

                """营业时间自动切换（自动开门 / 自动打烊）：inMinutes=距切换分钟数，today=是否发生在今天"""
                type CampusBusinessTransition {
                    """open=到点自动开门，close=到点自动打烊"""
                    action: String!
                    """切换时刻 HH:mm"""
                    at: String!
                    inMinutes: Int!
                    today: Boolean!
                }

                type CampusMerchantBoard {
                    paused: Boolean!
                    """营业时段内且未临时休息（自动开关门生效依据）"""
                    openNow: Boolean!
                    """本店营业时间（空=全天营业）"""
                    businessHours: String
                    """下一次自动开门/打烊（null=全天营业）"""
                    nextTransition: CampusBusinessTransition
                    merchantConfirmEnabled: Boolean!
                    printMode: String!
                    """打印通道（P1-4）：local=前端 C-Lodop / feie / yilianyun"""
                    printProvider: String!
                    """云通道账号/设备/密钥是否已配齐"""
                    cloudPrintConfigured: Boolean!
                    storeName: String!
                    storePhone: String
                    pending: [MerchantBoardOrder!]!
                    cooking: [MerchantBoardOrder!]!
                    awaitingRider: [MerchantBoardOrder!]!
                    delivering: [MerchantBoardOrder!]!
                    pendingDispatch: [MerchantBoardOrder!]!
                    thirdParty: [MerchantBoardOrder!]!
                    ownedPool: [MerchantBoardOrder!]!
                    ownedDispatched: [MerchantBoardOrder!]!
                    merchantDelivering: [MerchantBoardOrder!]!
                    scheduled: [MerchantBoardOrder!]!
                    completedToday: Int!
                    completedTodayAmount: Int!
                    """今日休业（§70 营业日历），true 时 C 端「今日休业」且禁止下单"""
                    closedToday: Boolean!
                    """今日休业备注（空=无备注或未休业）"""
                    closureNote: String
                    """未出餐订单数（§71）：待接单 + 备餐中"""
                    unfinishedOrders: Int!
                    """待处理顾客催单数（§78）"""
                    urgedCount: Int!
                    """待处理售后单数（§83 今日待办）：Pending + Appealed"""
                    afterSalesPending: Int!
                    """退款失败售后单数（§83 今日待办）：需商家人工重试"""
                    refundFailed: Int!
                    """出餐超时订单数（§83 今日待办）：待接单/备餐中等待 ≥25 分钟"""
                    overdueOrders: Int!
                    """日报未推送（§118 今日待办）：已开启推送、已过设定时间且今日尚未推送成功"""
                    dailyPushPending: Boolean!
                }

                """KDS 出餐屏单行（含加料快照）"""
                type CampusKitchenLine {
                    name: String!
                    quantity: Int!
                    addons: [String!]!
                }

                """KDS 出餐票：pending=待接单，cooking=制作中；urgency=normal/warn/late"""
                type CampusKitchenTicket {
                    id: ID!
                    code: String!
                    stage: String!
                    createdAt: DateTime!
                    waitingMinutes: Int!
                    urgency: String!
                    zone: String!
                    building: String!
                    slotText: String!
                    note: String
                    printedAt: DateTime
                    total: Int!
                    """顾客催单待处理（§78）：出餐屏置顶并标红"""
                    urged: Boolean!
                    lines: [CampusKitchenLine!]!
                }

                type CampusKitchenQueue {
                    tickets: [CampusKitchenTicket!]!
                    pendingCount: Int!
                    cookingCount: Int!
                    lateCount: Int!
                    """待处理顾客催单数（§78）"""
                    urgedCount: Int!
                    warnMinutes: Int!
                    lateMinutes: Int!
                }

                """备餐汇总（§79）：今日待做/已做份数，供后厨备料"""
                type CampusMerchantPrepAddon {
                    name: String!
                    quantity: Int!
                }

                type CampusMerchantPrepItem {
                    name: String!
                    """待接单份数"""
                    pendingQty: Int!
                    """备餐中份数"""
                    cookingQty: Int!
                    """今日已出餐（已送达）份数"""
                    doneQty: Int!
                    """待做合计 = 待接单 + 备餐中"""
                    todoQty: Int!
                    """今日合计 = 待做 + 已做"""
                    totalQty: Int!
                    addons: [CampusMerchantPrepAddon!]!
                }

                """营业日报（§80）：单日时段分布"""
                type CampusDailyHourPoint {
                    hour: Int!
                    orders: Int!
                    gross: Int!
                }

                """营业日报（§80）：单日商品销量行"""
                type CampusDailyProductRow {
                    name: String!
                    """销量（份）"""
                    qty: Int!
                    """商品金额（分，折后行小计汇总）"""
                    amount: Int!
                }

                """营业日报（§80）：对比口径（昨日 / 近 7 日均值）"""
                type CampusDailyCompare {
                    orders: Int!
                    gross: Int!
                    avgTicket: Int!
                }

                """营业日报（§80）：单日经营快照"""
                type CampusMerchantDailyReport {
                    """校园日 key（YYYY-MM-DD）"""
                    date: String!
                    """当日已完成（已送达）单量"""
                    orders: Int!
                    """当日营业额（分）"""
                    gross: Int!
                    """客单价（分）"""
                    avgTicket: Int!
                    """当日取消单量（按下单日归日）"""
                    cancelled: Int!
                    """当日取消退款金额（分）"""
                    cancelledAmount: Int!
                    """时段分布：今天只出到当前小时，历史日 24 点全出"""
                    hourly: [CampusDailyHourPoint!]!
                    """销量 Top5"""
                    topProducts: [CampusDailyProductRow!]!
                    """前一日同口径"""
                    prev: CampusDailyCompare!
                    """前 7 日（不含当日）日均"""
                    last7Avg: CampusDailyCompare!
                }

                """售后申请行（§81）：金额单位分"""
                type CampusMerchantAfterSalesItem {
                    id: ID!
                    orderId: ID!
                    """订单号（A2400xxx）"""
                    orderCode: String!
                    """售后单状态（Pending=待处理 / Refunded=已退款 / Rejected=已驳回 …）"""
                    state: String!
                    """售后类型（refund_only / return_refund / exchange）"""
                    type: String!
                    """顾客选择的售后原因"""
                    reason: String!
                    """顾客补充说明"""
                    description: String
                    """申请退款金额（分）"""
                    refundAmount: Int!
                    """商家驳回理由（顾客可见）"""
                    rejectReason: String
                    """顾客上传的凭证图片"""
                    evidenceImages: [String!]!
                    """协商留言条数"""
                    messageCount: Int!
                    """顾客姓名"""
                    customerName: String
                    createdAt: DateTime!
                    """退款到账时间"""
                    refundedAt: DateTime
                    """待处理且已超过渠道处理时限（售后插件 afterSalesTimeoutHours）"""
                    overdue: Boolean!
                    """最新一条留言来自顾客且商家尚未回复"""
                    unread: Boolean!
                    """换货运单号（§83）"""
                    exchangeTrackingNo: String
                    """换货承运商（§83）"""
                    exchangeCarrier: String
                    """即将超时（§88）：未超时但剩余时间不足渠道阈值"""
                    dueSoon: Boolean!
                    """售后标签名（§88）：本店自定义标签"""
                    tags: [String!]!
                    """指派处理人 User id（未指派为空，§89）"""
                    assigneeUserId: ID
                    """处理人姓名（未指派或未匹配为空，§89）"""
                    assigneeName: String
                    """风险标记原因（未标记/已解除为空，§94）"""
                    riskReason: String
                    """SLA 计时已暂停（§95）：等待顾客配合期间不判超时/临期"""
                    slaPaused: Boolean!
                    """当前暂停原因（§96）：未暂停为空"""
                    slaPausedReason: String
                    """已升级平台仲裁且工单未关闭（§96）"""
                    escalated: Boolean!
                    """已提交大额退款复核、等待其他管理员确认（§99）"""
                    refundReviewPending: Boolean!
                    """退款失败原因（§110）：仅 RefundFailed 有值"""
                    refundError: String
                }

                """售后状态计数（§81）：列表页签角标"""
                type CampusMerchantAfterSalesStateCount {
                    state: String!
                    count: Int!
                }

                """售后申请清单（§81）"""
                type CampusMerchantAfterSalesList {
                    items: [CampusMerchantAfterSalesItem!]!
                    """待商家处理数（Pending + Appealed），不受筛选影响，供入口红点"""
                    pendingCount: Int!
                    """当前筛选条件命中总数"""
                    total: Int!
                    """全店各状态计数（不受 state 筛选影响）"""
                    stateCounts: [CampusMerchantAfterSalesStateCount!]!
                    skip: Int!
                    take: Int!
                }

                """协商留言行（§81）：顾客与商家双向可见"""
                type CampusMerchantAfterSalesMessage {
                    id: ID!
                    """customer=顾客 / admin=商家"""
                    senderType: String!
                    senderName: String!
                    content: String!
                    images: [String!]!
                    createdAt: DateTime!
                }

                """状态流转时间线（售后详情）"""
                type CampusMerchantAfterSalesHistory {
                    fromState: String
                    toState: String!
                    createdAt: DateTime!
                    """处理人 User id（顾客/系统路径为空，§88）"""
                    operatorUserId: ID
                    """处理人姓名（管理员；为空=顾客或系统自动，§88）"""
                    operatorName: String
                }

                """收货地址（售后详情核对用）"""
                type CampusMerchantAfterSalesAddress {
                    fullName: String!
                    phoneNumber: String!
                    address: String!
                }

                """订单商品行（售后详情核对用）"""
                type CampusMerchantAfterSalesLine {
                    name: String!
                    quantity: Int!
                    """行单价（含税，分）"""
                    unitPrice: Int!
                }

                """售后详情（§81）：售后单 + 协商留言 + 状态时间线 + 退款失败留痕"""
                type CampusMerchantAfterSalesDetail {
                    request: CampusMerchantAfterSalesItem!
                    messages: [CampusMerchantAfterSalesMessage!]!
                    """留言总条数（列表最多回传 100 条）"""
                    messageTotal: Int!
                    stateHistory: [CampusMerchantAfterSalesHistory!]!
                    """退款失败原因（RefundFailed 留痕）"""
                    refundError: String
                    """实际退款到账金额（分，未退款为 null）"""
                    actualRefundAmount: Int
                    """渠道处理时限（小时）"""
                    timeoutHours: Int!
                    """顾客手机号"""
                    customerPhone: String
                    """订单收货地址"""
                    shippingAddress: CampusMerchantAfterSalesAddress
                    """订单商品行"""
                    orderItems: [CampusMerchantAfterSalesLine!]!
                    """订单实付总额（含税，分）"""
                    orderTotal: Int!
                    """指派变更历史（§92），按时间倒序"""
                    assignHistory: [CampusMerchantAfterSalesAssignLog!]!
                    """顾客回访记录（§94），按时间倒序"""
                    followUps: [CampusMerchantAfterSalesFollowUp!]!
                    """SLA 暂停历史（§96），按暂停时间倒序"""
                    slaPauses: [CampusMerchantAfterSalesSlaPause!]!
                    """平台仲裁升级记录（§96），按时间倒序"""
                    escalations: [CampusMerchantAfterSalesEscalation!]!
                }

                """SLA 暂停记录（§96）：起止时间与原因"""
                type CampusMerchantAfterSalesSlaPause {
                    id: ID!
                    reason: String!
                    pausedAt: DateTime!
                    """恢复时间（仍在暂停为空）"""
                    resumedAt: DateTime
                    """本次暂停时长（毫秒，未恢复为 0）"""
                    pausedMs: Int!
                }

                """平台仲裁升级工单（§96）"""
                type CampusMerchantAfterSalesEscalation {
                    id: ID!
                    requestId: ID!
                    reason: String!
                    """normal / urgent"""
                    priority: String!
                    """Open / Resolved"""
                    status: String!
                    createdBy: ID
                    creatorName: String
                    createdAt: DateTime!
                    resolvedAt: DateTime
                    resolution: String
                }

                """顾客回访记录（§94）：电话/线上沟通留痕"""
                type CampusMerchantAfterSalesFollowUp {
                    id: ID!
                    """回访方式：phone / wechat / onsite / other"""
                    method: String!
                    """回访结果：reached / unreached / refused / other"""
                    result: String!
                    note: String
                    """下次跟进时间（空=无需再跟）"""
                    nextAt: DateTime
                    operatorName: String
                    createdAt: DateTime!
                }

                """线下退款登记回执（§94）"""
                type CampusMerchantAfterSalesOfflineRefundResult {
                    id: ID!
                    state: String!
                    """本次登记退款金额（分）"""
                    actualRefundAmount: Int!
                    refundedAt: DateTime!
                }

                """指派变更记录（§92）"""
                type CampusMerchantAfterSalesAssignLog {
                    fromUserId: ID
                    fromName: String
                    toUserId: ID
                    toName: String
                    """转交/指派原因（§99）"""
                    reason: String
                    createdAt: DateTime!
                }

                """商品售后统计（§92）：区间内某商品的售后单量/退款与售后率"""
                type CampusMerchantAfterSalesProductRow {
                    productId: ID!
                    productName: String!
                    requestCount: Int!
                    refundCount: Int!
                    """退款金额（分）"""
                    refundAmount: Int!
                    """售后率（百分比）：售后单数 / 该商品区间订单数"""
                    requestRate: Int!
                }

                """售后原因分布（§93）：区间内按原因聚合"""
                type CampusMerchantAfterSalesReasonRow {
                    reason: String!
                    requestCount: Int!
                    refundCount: Int!
                    """退款金额（分，仅已退款单）"""
                    refundAmount: Int!
                    """占比（百分比）"""
                    share: Int!
                    """上一等长区间同原因单量"""
                    previousCount: Int!
                    """环比变化（百分比，上一期为 0 时为 null）"""
                    changeRate: Int
                }

                """顾客最近售后单（§93）"""
                type CampusMerchantAfterSalesCustomerRecent {
                    id: ID!
                    orderCode: String!
                    type: String!
                    state: String!
                    """申请退款金额（分）"""
                    amount: Int!
                    createdAt: DateTime!
                }

                """顾客售后档案（§93）：本店维度聚合"""
                type CampusMerchantAfterSalesCustomerProfile {
                    customerId: ID!
                    name: String!
                    """手机号（脱敏）"""
                    phone: String
                    blacklisted: Boolean!
                    requestCount: Int!
                    refundedCount: Int!
                    """累计退款金额（分，仅已退款单）"""
                    refundAmount: Int!
                    firstAt: DateTime
                    lastAt: DateTime
                    """最近 10 条售后单"""
                    recent: [CampusMerchantAfterSalesCustomerRecent!]!
                }

                """满意度分档（§93）"""
                type CampusMerchantAfterSalesReviewBucket {
                    score: Int!
                    count: Int!
                }

                """低分待跟进（§93）：score <= 2"""
                type CampusMerchantAfterSalesLowReview {
                    id: ID!
                    requestId: ID!
                    orderCode: String!
                    customerName: String
                    score: Int!
                    comment: String
                    followedUp: Boolean!
                    createdAt: DateTime!
                }

                """评价标签计数（§98）"""
                type CampusMerchantAfterSalesReviewTagCount {
                    tag: String!
                    count: Int!
                }

                """退款后满意度汇总（§93、§98）"""
                type CampusMerchantAfterSalesReviewSummary {
                    total: Int!
                    """平均分（保留 1 位小数，无评分为 0）"""
                    avgScore: Float!
                    """1-5 分档人数（固定 5 项）"""
                    distribution: [CampusMerchantAfterSalesReviewBucket!]!
                    """低分（<=2）条数"""
                    lowScoreCount: Int!
                    """低分待跟进明细（最近 20 条）"""
                    lowScores: [CampusMerchantAfterSalesLowReview!]!
                    """评价标签 Top（§98）：按出现次数降序，最多 10 项"""
                    topTags: [CampusMerchantAfterSalesReviewTagCount!]!
                }

                """商品维度售后行（§98，件数口径）"""
                type CampusMerchantAfterSalesProductRateRow {
                    productId: ID!
                    productName: String!
                    """区间内下单件数（不含已取消订单）"""
                    soldQuantity: Int!
                    """区间内售后单数"""
                    requestCount: Int!
                    """区间内已退款单数"""
                    refundCount: Int!
                    """区间内退款金额（分）"""
                    refundAmount: Int!
                    """售后率（百分比，保留 1 位小数）"""
                    afterSalesRate: Float!
                }

                """商品维度售后分析（§98，件数口径）"""
                type CampusMerchantAfterSalesProductRateAnalysis {
                    items: [CampusMerchantAfterSalesProductRateRow!]!
                    totalRequests: Int!
                    totalRefundAmount: Int!
                    totalSold: Int!
                }

                """退货物流轨迹节点（§98）"""
                type CampusMerchantAfterSalesReturnLogisticsEvent {
                    """approved / shipped / picked_up / in_transit / delivered / exception / closed"""
                    status: String!
                    description: String!
                    occurredAt: DateTime!
                    """system=系统按状态派生 / merchant=商家登记"""
                    source: String!
                }

                """退货物流（§98）：运单信息 + 轨迹时间线"""
                type CampusMerchantAfterSalesReturnLogistics {
                    requestId: ID!
                    orderCode: String!
                    type: String!
                    state: String!
                    trackingNo: String
                    carrier: String
                    events: [CampusMerchantAfterSalesReturnLogisticsEvent!]!
                }

                """售后自动分流规则（§98）"""
                type CampusMerchantAfterSalesAutoRule {
                    id: ID!
                    name: String!
                    """匹配优先级：越小越先命中"""
                    priority: Int!
                    enabled: Boolean!
                    """* 或售后类型"""
                    matchType: String!
                    matchReason: String
                    minAmount: Int
                    maxAmount: Int
                    """approve / reject / escalate"""
                    action: String!
                    rejectReason: String
                    createdAt: DateTime!
                }

                """售后处理统计（§81）：入口红点 + 今日处理量/退款额"""
                type CampusMerchantAfterSalesStats {
                    """待商家处理（Pending + Appealed）"""
                    pending: Int!
                    """待处理中已超时的单数"""
                    overdue: Int!
                    """渠道处理时限（小时）"""
                    timeoutHours: Int!
                    """今日已处理售后单数"""
                    todayHandled: Int!
                    """今日退款成功单数"""
                    todayRefunded: Int!
                    """今日退款金额（分）"""
                    todayRefundAmount: Int!
                    """待商家回复的售后会话数"""
                    pendingReply: Int!
                    """临期未处理单数（§88）"""
                    dueSoon: Int!
                    """渠道临期提醒阈值（小时，0=关闭）"""
                    dueSoonHours: Int!
                }

                """售后标签（§88）：本店渠道自定义"""
                type CampusMerchantAfterSalesTag {
                    id: ID!
                    name: String!
                    """当前打标单数"""
                    usedCount: Int!
                }

                """售后处理人候选（§89）：本店渠道管理员"""
                type CampusMerchantAfterSalesAssignee {
                    """管理员 User id（指派时传该值）"""
                    id: ID!
                    name: String!
                    """登录账号"""
                    identifier: String!
                }

                """员工处理绩效（§89）：按操作人统计"""
                type CampusMerchantAfterSalesStaffRow {
                    operatorUserId: ID!
                    operatorName: String!
                    """处理过的售后单数（去重）"""
                    handled: Int!
                    """推进到完结（Refunded/Closed）的单数"""
                    resolved: Int!
                    """首次操作距申请的平均分钟"""
                    firstActionAvgMinutes: Int!
                    """完结操作距申请的平均分钟（无完结为 0）"""
                    resolveAvgMinutes: Int!
                    """经手单中当前仍超时未处理的单数（§97）"""
                    overdueCount: Int!
                    """经手单中已升级平台仲裁的单数（§97）"""
                    escalatedCount: Int!
                    """完结率（百分比 0-100，§97）"""
                    resolveRate: Int!
                    """经手单收到的满意度评分数（§98）"""
                    reviewCount: Int!
                    """经手单满意度平均分（1 位小数，无评分为 0，§98）"""
                    reviewAvgScore: Float!
                }

                """售后工作台摘要（§88）：一次返回各待办入口与最老待处理时长"""
                type CampusMerchantAfterSalesWorkbench {
                    """待同意（Pending + Appealed）"""
                    toApprove: Int!
                    """待收货（Returning）"""
                    toReceive: Int!
                    """退款失败待人工"""
                    refundFailed: Int!
                    """待回复留言"""
                    pendingReply: Int!
                    """已超时待处理"""
                    overdue: Int!
                    """临期未处理"""
                    dueSoon: Int!
                    """SLA 计时已暂停的待处理单（§95）"""
                    slaPaused: Int!
                    """回访到期未跟进单数（§95）"""
                    followUpDue: Int!
                    """已升级平台仲裁且未关闭的单数（§96）"""
                    escalated: Int!
                    """最早一笔待处理单申请时间"""
                    oldestPendingAt: DateTime
                    """最老待处理单已等待小时数"""
                    oldestPendingHours: Int!
                }

                """批量售后处理逐单结果（§83）"""
                type CampusMerchantAfterSalesBatchResult {
                    id: ID!
                    success: Boolean!
                    """成功后的售后状态，失败为空串"""
                    state: String!
                    """失败原因（成功为空串）"""
                    message: String!
                }

                """售后报表类型分桶（§83）"""
                type CampusMerchantAfterSalesReportType {
                    type: String!
                    count: Int!
                }

                """售后报表状态分桶（§83）"""
                type CampusMerchantAfterSalesReportState {
                    state: String!
                    count: Int!
                }

                """售后报表逐日趋势（§83）：date=校园日 YYYY-MM-DD"""
                type CampusMerchantAfterSalesReportDay {
                    date: String!
                    """当日新建售后单数"""
                    count: Int!
                    """当日退款成功单数"""
                    refunded: Int!
                    """当日退款金额（分）"""
                    refundAmount: Int!
                }

                """售后报表（§83）：区间内量/退款/超时与逐日趋势"""
                type CampusMerchantAfterSalesReport {
                    from: String!
                    to: String!
                    total: Int!
                    byType: [CampusMerchantAfterSalesReportType!]!
                    byState: [CampusMerchantAfterSalesReportState!]!
                    """区间内退款成功单数（按退款时间归集）"""
                    refunded: Int!
                    """区间内退款金额（分）"""
                    refundAmount: Int!
                    """区间内创建且当前仍超时的待处理单数"""
                    overdue: Int!
                    byDay: [CampusMerchantAfterSalesReportDay!]!
                    """顾客申请原因 Top5"""
                    reasons: [CampusMerchantAfterSalesReportReason!]!
                    """商家驳回原因 Top5"""
                    rejectReasons: [CampusMerchantAfterSalesReportReason!]!
                    """首次响应均值（分钟）：创建→商家首条留言"""
                    firstResponseAvgMinutes: Int!
                    firstResponseMaxMinutes: Int!
                    """完结均值（分钟）：创建→Refunded/Closed"""
                    resolveAvgMinutes: Int!
                    resolveMaxMinutes: Int!
                    """首响目标达标率（百分比，0=未设目标或无数据）"""
                    firstResponseOnTargetRate: Int!
                    """完结目标达标率（百分比，0=未设目标或无数据）"""
                    resolveOnTargetRate: Int!
                    """超出首响目标单数 / 超出完结目标单数"""
                    firstResponseOverdue: Int!
                    resolveOverdue: Int!
                    """上一周期对照（§90）：新建单数 / 退款单数 / 退款金额（分） / 超时单数"""
                    previousTotal: Int!
                    previousRefunded: Int!
                    previousRefundAmount: Int!
                    previousOverdue: Int!
                }

                """本店拉黑顾客（§90）：仅商家可见"""
                type CampusMerchantAfterSalesBlacklistEntry {
                    id: ID!
                    customerId: ID
                    customerName: String
                    """手机号（脱敏）"""
                    phone: String
                    reason: String
                    createdBy: String!
                    createdAt: DateTime!
                }

                """处理人负载（§91）：未完结 / 超时 / 临期 单数"""
                type CampusMerchantAfterSalesAssigneeLoad {
                    """管理员 User id；0 表示未指派"""
                    assigneeUserId: ID!
                    assigneeName: String!
                    openCount: Int!
                    overdueCount: Int!
                    dueSoonCount: Int!
                }

                """商家售后内部备注（§86）：仅商家可见"""
                type CampusMerchantAfterSalesNote {
                    id: ID!
                    content: String!
                    createdBy: String!
                    createdAt: DateTime!
                }

                """售后原因分桶（§84）"""
                type CampusMerchantAfterSalesReportReason {
                    reason: String!
                    count: Int!
                }

                """售后规则配置（§84）：0 表示关闭对应自动化"""
                type CampusMerchantAfterSalesRules {
                    """待处理超时提醒（小时）"""
                    timeoutHours: Int!
                    """超时自动同意（小时，0=关闭）"""
                    autoApproveHours: Int!
                    """退款失败自动重试次数（0=关闭）"""
                    refundAutoRetry: Int!
                    """首响目标（小时，0=不考核）"""
                    firstResponseTargetHours: Int!
                    """完结目标（小时，0=不考核）"""
                    resolveTargetHours: Int!
                    """临期提醒阈值（小时，0=关闭，§88）"""
                    dueSoonHours: Int!
                    """大额退款复核阈值（分，0=关闭，§99）"""
                    refundReviewThreshold: Int!
                }

                """大额退款复核记录（§99）：申请人以外的管理员确认后才退款"""
                type CampusMerchantAfterSalesRefundReview {
                    id: ID!
                    requestId: ID!
                    orderId: ID!
                    """订单号（A2400xxx）"""
                    orderCode: String!
                    """退款金额（分）"""
                    amount: Int!
                    """复核状态（Pending/Approved/Rejected）"""
                    status: String!
                    """申请人 User id"""
                    requestedBy: String!
                    """申请人姓名"""
                    requestedByName: String
                    """申请时间"""
                    requestedAt: DateTime!
                    """复核人 User id（未复核为空）"""
                    reviewedBy: String
                    """复核人姓名（未复核为空）"""
                    reviewedByName: String
                    """复核时间（未复核为空）"""
                    reviewedAt: DateTime
                    """复核备注"""
                    note: String
                    """当前登录者即申请人（不能再复核，§99）"""
                    selfRequested: Boolean!
                }

                """智能话术推荐（§99）：按售后原因/类型匹配的快捷回复"""
                type CampusMerchantAfterSalesSuggestedReply {
                    """模板 id"""
                    id: ID!
                    """建议回复内容"""
                    content: String!
                    """匹配得分：越高越相关"""
                    score: Int!
                }

                """售后操作审计行（§100）：统一操作留痕"""
                type CampusMerchantAfterSalesAuditRow {
                    id: ID!
                    requestId: ID!
                    """订单号（A2400xxx）"""
                    orderCode: String
                    """操作动作（approve/reject/close/transfer/assign…）"""
                    action: String!
                    """处理人 User id（系统操作为空）"""
                    actorUserId: String
                    """处理人姓名"""
                    actorName: String
                    """操作详情"""
                    detail: String
                    createdAt: DateTime!
                }

                """售后值班条目（§100）：weekday 0=周日，跨零点 endMin>1440"""
                type CampusMerchantAfterSalesDutyEntry {
                    weekday: Int!
                    startMin: Int!
                    endMin: Int!
                    userId: ID!
                    userName: String
                }

                """补偿挽留方案（§100）：部分退款 + 优惠券补偿"""
                type CampusMerchantAfterSalesCompensationPlan {
                    id: ID!
                    name: String!
                    """退款金额（分，0=只发券）"""
                    refundAmount: Int!
                    """优惠券模板 id（空=不发券）"""
                    couponTemplateId: String
                    note: String
                    enabled: Boolean!
                    createdAt: DateTime!
                }

                """补偿发放结果（§100）"""
                type CampusMerchantAfterSalesCompensationResult {
                    ok: Boolean!
                    """本次退款金额（分）"""
                    refundAmount: Int!
                    """补偿券是否发放成功"""
                    couponGranted: Boolean!
                    """降级说明（发券失败等）"""
                    message: String!
                }

                """商家快捷回复模板（§87）：本店渠道共用"""
                type CampusMerchantAfterSalesReplyTemplate {
                    id: ID!
                    content: String!
                    createdAt: DateTime!
                    """分类标签（§97 知识库），未分类为 null"""
                    category: String
                    """检索关键词（空格分隔，§97）"""
                    keywords: String
                    """排序权重：越小越靠前（§97）"""
                    sortOrder: Int!
                }

                """退款流水（§84）：按退款时间倒序"""
                type CampusMerchantAfterSalesRefund {
                    id: ID!
                    orderCode: String
                    type: String!
                    reason: String!
                    """实际退款金额（分）"""
                    amount: Int!
                    refundedAt: DateTime
                    refundTransactionId: String
                }

                type CampusMerchantAfterSalesRefundList {
                    items: [CampusMerchantAfterSalesRefund!]!
                    total: Int!
                }

                """售后自动化任务（§85）：超时提醒/自动同意/退款重试"""
                type CampusMerchantAfterSalesTask {
                    id: ID!
                    """pending_remind | pending_auto_approve | refund_retry"""
                    type: String!
                    requestId: Int!
                    """pending | cancelled | executed | failed"""
                    status: String!
                    dueAt: DateTime!
                    """业务次数（退款重试已执行次数）"""
                    attempt: Int!
                    """业务上限"""
                    maxAttempt: Int!
                    """执行失败重试次数"""
                    retryCount: Int!
                    lastError: String
                    executedAt: DateTime
                }

                type CampusMerchantAfterSalesTaskList {
                    items: [CampusMerchantAfterSalesTask!]!
                    total: Int!
                }

                """高频售后顾客（§85）：手机号脱敏"""
                type CampusMerchantAfterSalesTopCustomer {
                    customerId: ID!
                    name: String!
                    phone: String!
                    count: Int!
                    """区间内退款额（分）"""
                    refundAmount: Int!
                    blacklisted: Boolean!
                }

                """云打印结果：dryRun 保留给未接真实设备的联调场景"""
                type CampusPrintResult {
                    ok: Boolean!
                    provider: String!
                    dryRun: Boolean!
                    jobId: ID
                    error: String
                }

                """云打印任务留痕（排障/重打依据）"""
                type CampusPrintJob {
                    id: ID!
                    orderId: ID
                    orderCode: String
                    provider: String!
                    deviceSn: String
                    status: String!
                    triggerType: String!
                    copies: Int!
                    dryRun: Boolean!
                    errorMessage: String
                    durationMs: Int
                    createdAt: DateTime!
                }

                """商家自助经营：门店资料（营业状态按校园时区判定）"""
                type MerchantStoreProfile {
                    storeName: String!
                    businessHours: String
                    storeNotice: String
                    storePhone: String
                    paused: Boolean!
                    openNow: Boolean!
                    """今日是否休业（§70 营业日历），true 时 C 端「今日休业」且禁止下单"""
                    closedToday: Boolean!
                    """今日休业备注（空=无备注或未休业）"""
                    closureNote: String
                    """已登记的休业日期（升序，已过期的不返回）"""
                    closureDates: [CampusClosureDate!]!
                    """下一次自动开门/打烊（null=全天营业）"""
                    nextTransition: CampusBusinessTransition
                    """未出餐订单数（§71）：待接单 + 备餐中"""
                    unfinishedOrders: Int!
                    """每日日报推送开关（§86）：营业结束后把昨日日报推到店铺群"""
                    dailyPushEnabled: Boolean!
                    """日报推送时间 HH:MM（默认 21:30）"""
                    dailyPushTime: String!
                    """推送渠道是否可用（§118）：false 时设置页提示「未配置推送渠道，请联系运营」"""
                    dailyPushChannelReady: Boolean!
                    """最近一次推送失败时间（epoch ms，§119）：0 = 无可见失败"""
                    dailyPushLastFailAt: Float!
                    """最近一次推送失败原因（§119）：空 = 无可见失败"""
                    dailyPushLastFailReason: String!
                    """售后月度摘要推送开关（§95）"""
                    monthlyPushEnabled: Boolean!
                    """月度推送日（1-28，默认 1）"""
                    monthlyPushDay: Int!
                    """月度推送时间 HH:MM（默认 21:30）"""
                    monthlyPushTime: String!
                    """售后自动分配开关（§96）"""
                    autoAssignEnabled: Boolean!
                    """自动分配单人未完结上限（0=不限）"""
                    autoAssignMax: Int!
                    """售后异常预警推送开关（§96）"""
                    alertEnabled: Boolean!
                    """退款率预警阈值（百分比，0=关闭该项）"""
                    alertRefundRate: Int!
                    """超时待处理预警阈值（单，0=关闭该项）"""
                    alertOverdueCount: Int!
                    """信任文案（§113）：质量行开关（关=该行不展示）"""
                    trustQualityEnabled: Boolean!
                    """质量行自定义文案（空=回落 C 端默认文案）"""
                    trustQualityText: String
                    """服务行开关"""
                    trustServiceEnabled: Boolean!
                    """服务行自定义文案（空=回落默认）"""
                    trustServiceText: String
                    """时间行开关"""
                    trustTimeEnabled: Boolean!
                    """时间行自定义文案（空=回落默认）"""
                    trustTimeText: String
                }

                """休业日期（§70 营业日历）：date=校园时区自然日 YYYY-MM-DD"""
                type CampusClosureDate {
                    date: String!
                    note: String
                }

                """经营数据分桶（分）：营业额=窗口内已送达订单实付；取消=窗口内取消单（全额退款口径）"""
                type CampusMerchantRevenueBucket {
                    orders: Int!
                    gross: Int!
                    avgTicket: Int!
                    cancelled: Int!
                    cancelledAmount: Int!
                }

                type CampusMerchantRevenueDay {
                    date: String!
                    """完整日期 YYYY-MM-DD（自定义区间导出跨年可区分）"""
                    dateFull: String!
                    orders: Int!
                    gross: Int!
                    cancelled: Int!
                    cancelledAmount: Int!
                }

                type CampusMerchantRevenue {
                    today: CampusMerchantRevenueBucket!
                    last7: CampusMerchantRevenueBucket!
                    days: [CampusMerchantRevenueDay!]!
                    """P3-2 导出用：近 30 日（含今日）逐日明细，口径与 days 一致"""
                    days30: [CampusMerchantRevenueDay!]!
                }

                type DispatchAlert {
                    orderId: ID!
                    orderCode: String!
                    type: String!
                    detail: String!
                    exceptionNote: String
                    exceptionPhotos: [String!]
                }

                type DispatchRider {
                    customerId: ID!
                    realName: String!
                    credit: Int!
                }

                type HandedException {
                    orderId: ID!
                    orderCode: String!
                    exceptionType: String
                    action: String!
                    compensation: Int
                    couponTemplateId: String
                    note: String
                    handledAt: String
                    handledBy: String!
                }

                type CampusDispatchBoard {
                    paused: Boolean!
                    alerts: [DispatchAlert!]!
                    hallOrders: [Order!]!
                    activeOrders: [Order!]!
                    ridersOnline: [DispatchRider!]!
                    handledOrders: [HandedException!]!
                }

                type CampusDispatchResult {
                    assigned: Boolean
                    backToHall: Boolean
                }
                type CampusHandleExceptionResult {
                    ok: Boolean
                    action: String
                }

                type CampusErrandProductResult {
                    variantId: ID!
                    sku: String!
                }

                type CampusEnsureProfileResult {
                    profileId: ID!
                    profileName: String!
                    linkedMethodCodes: [String!]!
                    missingMethodCodes: [String!]!
                    boundVariantCount: Int!
                }

                """第一段承运方（仅 R1: merchant|owned，R3: campus|owned|external）"""
                type CampusRouteCarrier {
                    route: String!
                    carrier: String!
                }

                input CampusRouteCarrierInput {
                    route: String!
                    carrier: String!
                }

                """校园交接点（仅 R1、R2 需要，同一路线可配多个，按收货楼栋取最近）"""
                type CampusHandoverPoint {
                    route: String!
                    name: String!
                    address: String
                    phone: String
                    lat: Float!
                    lng: Float!
                    """无收货坐标时的兜底默认点"""
                    isDefault: Boolean!
                }

                input CampusHandoverPointInput {
                    route: String!
                    name: String!
                    address: String
                    phone: String
                    lat: Float!
                    lng: Float!
                    """无收货坐标时的兜底默认点（每条路线只保留一个）"""
                    isDefault: Boolean
                }

                """外部快递门店编号（运营中心维护，不对外暴露给商户）"""
                type CampusProviderShopNo {
                    provider: String!
                    shopNo: String!
                }

                input CampusProviderShopNoInput {
                    provider: String!
                    shopNo: String!
                }

                type CampusStoreConfigWithChannel {
                    channelId: ID!
                    channelName: String!
                    channelToken: String!
                    routesEnabled: [String!]!
                    routeFirstLeg: [CampusRouteCarrier!]!
                    handoverPoints: [CampusHandoverPoint!]!
                    providerShopNo: [CampusProviderShopNo!]!
                    merchantAcceptMinutes: Int!
                    externalPushTimeoutMinutes: Int!
                    externalFallbackMinutes: Int!
                    storeLat: Float
                    storeLng: Float
                    deliveryMinutes: Int
                    minOrderAmount: Int
                    deliveryFee: Int
                    storeAddress: String
                    storePhone: String
                    storeNotice: String
                    errandBaseFee: Int
                    thirdPartyBaseFee: Int
                    freeShippingThreshold: Int
                    """配送费阶梯（P3-4）JSON：[{minAmount:分, fee:分}]，null=不启用"""
                    deliveryFeeTiers: String
                    dynamicPricing: String
                    notifyTemplateAccepted: String
                    notifyTemplateRiderAssigned: String
                    notifyTemplateCookingDone: String
                    notifyTemplateDelivered: String
                    notifyTemplateExceptionHandled: String
                    """第一段交接完成：餐/包裹已到校园交接点"""
                    notifyTemplateArrivedHandover: String
                    """配送方式降级/异常重派（超时转传信者、外部运力异常）"""
                    notifyTemplateDeliveryFallback: String
                    notifyTemplateOrderPlaced: String
                    notifyTemplatePaymentPending: String
                    notifyTemplateCancelled: String
                    notifyTemplateAfterSales: String
                    notifyTemplateAddressChanged: String
                    h5BaseUrl: String
                    printMode: String!
                    """打印通道（P1-4）：local / feie / yilianyun"""
                    printProvider: String!
                    printAccount: String
                    printDeviceSn: String
                    printDeviceKey: String
                    """打印联数（1-5）"""
                    printCopies: Int!
                    timeoutCompensationEnabled: Boolean!
                    timeoutGraceMinutes: Int!
                    """超时赔付回扫窗口（小时，1-168），默认 24"""
                    timeoutCompensationWindowHours: Int!
                    timeoutCompensationCouponTemplateId: String
                    """号码保护开关：开启后骑手/商家/客服侧不下发顾客真实手机号"""
                    privacyNumberEnabled: Boolean!
                    """隐私号服务商：mask / mock / aliyun / tencent"""
                    privacyNumberProvider: String!
                    """实际生效的服务商（外部号池未接入时回落 mask）"""
                    privacyNumberEffectiveProvider: String!
                    """配置值≠生效值：号码保护未真正启用，后台需提示运营"""
                    privacyNumberDegraded: Boolean!
                    privacyNumberNote: String
                    privacyNumberTtlMinutes: Int!
                    privacyNumberPrefix: String
                    foodLicenseNo: String
                    foodLicenseImage: String
                    foodLicenseExpiry: String
                    foodSafetyGrade: String
                    foodSafetyCommitmentImage: String
                    kitchenLiveUrl: String
                    kitchenLiveEnabled: Boolean!
                    """打包费开关"""
                    packingFeeEnabled: Boolean!
                    """计费方式：perItem=按件累加 / perOrder=每单固定"""
                    packingFeeMode: String!
                    """打包费金额（分）：perItem=单件，perOrder=每单"""
                    packingFeeAmount: Int!
                    """单笔封顶（分，null=不封顶）"""
                    packingFeeCap: Int
                    """C 端展示名称（空=打包费）"""
                    packingFeeLabel: String
                    """小程序 AppID（wx + 16 位十六进制）"""
                    mpAppId: String
                    """服务类目（如「餐饮/外卖」）"""
                    mpCategory: String
                    """当前上架版本号（x.y.z）"""
                    mpVersion: String
                    """上架状态：draft / inReview / online / rejected / offline"""
                    mpListingStatus: String!
                    """用户隐私保护指引地址"""
                    mpPrivacyUrl: String
                    """审核备注 / 驳回原因"""
                    mpReviewNote: String
                    """上架前检查是否齐全（AppID/类目/版本/隐私指引/客服电话/食品许可证）"""
                    mpReady: Boolean!
                    """上架前检查缺项 key：appId / category / version / privacyUrl / contactPhone / licenseNo"""
                    mpMissing: [String!]!
                    """语音搜索服务商：mock（内置模拟）/ none（未开启）"""
                    voiceSearchProvider: String!
                    """拍照搜索服务商：mock（内置模拟）/ none（未开启）"""
                    imageSearchProvider: String!
                }

                """隐私联系方式（号码保护）：protected=false 时 display 即真实号"""
                type CampusPrivacyContact {
                    protected: Boolean!
                    display: String
                    callable: String
                    provider: String!
                    expiresAt: DateTime
                    note: String
                }

                input CampusStoreConfigInput {
                    routesEnabled: [String!]!
                    routeFirstLeg: [CampusRouteCarrierInput!]
                    handoverPoints: [CampusHandoverPointInput!]
                    providerShopNo: [CampusProviderShopNoInput!]
                    merchantAcceptMinutes: Int
                    externalPushTimeoutMinutes: Int
                    externalFallbackMinutes: Int
                    storeLat: Float
                    storeLng: Float
                    deliveryMinutes: Int
                    minOrderAmount: Int
                    deliveryFee: Int
                    storeAddress: String
                    storePhone: String
                    storeNotice: String
                    errandBaseFee: Int
                    thirdPartyBaseFee: Int
                    freeShippingThreshold: Int
                    """配送费阶梯（P3-4）JSON：[{minAmount:分, fee:分}]，null=不启用"""
                    deliveryFeeTiers: String
                    dynamicPricing: String
                    notifyTemplateAccepted: String
                    notifyTemplateRiderAssigned: String
                    notifyTemplateCookingDone: String
                    notifyTemplateDelivered: String
                    notifyTemplateExceptionHandled: String
                    """第一段交接完成：餐/包裹已到校园交接点"""
                    notifyTemplateArrivedHandover: String
                    """配送方式降级/异常重派（超时转传信者、外部运力异常）"""
                    notifyTemplateDeliveryFallback: String
                    notifyTemplateOrderPlaced: String
                    notifyTemplatePaymentPending: String
                    notifyTemplateCancelled: String
                    notifyTemplateAfterSales: String
                    notifyTemplateAddressChanged: String
                    h5BaseUrl: String
                    printMode: String
                    """打印通道：local（默认）/ feie / yilianyun；云通道须同时传账号/设备/密钥"""
                    printProvider: String
                    printAccount: String
                    printDeviceSn: String
                    printDeviceKey: String
                    printCopies: Int
                    timeoutCompensationEnabled: Boolean
                    timeoutGraceMinutes: Int
                    timeoutCompensationWindowHours: Int
                    timeoutCompensationCouponTemplateId: String
                    privacyNumberEnabled: Boolean
                    privacyNumberProvider: String
                    privacyNumberTtlMinutes: Int
                    privacyNumberPrefix: String
                    foodLicenseNo: String
                    foodLicenseImage: String
                    foodLicenseExpiry: String
                    foodSafetyGrade: String
                    foodSafetyCommitmentImage: String
                    kitchenLiveUrl: String
                    kitchenLiveEnabled: Boolean
                    packingFeeEnabled: Boolean
                    packingFeeMode: String
                    packingFeeAmount: Int
                    packingFeeCap: Int
                    packingFeeLabel: String
                    mpAppId: String
                    mpCategory: String
                    mpVersion: String
                    """上架状态：draft / inReview / online / rejected / offline"""
                    mpListingStatus: String
                    mpPrivacyUrl: String
                    mpReviewNote: String
                    """语音搜索服务商：mock / none（undefined=保留原值）"""
                    voiceSearchProvider: String
                    """拍照搜索服务商：mock / none（undefined=保留原值）"""
                    imageSearchProvider: String
                }

                type RiderWithdrawalRequest {
                    id: ID!
                    customerId: ID!
                    channelId: ID!
                    amount: Int!
                    channel: String!
                    account: String!
                    status: String!
                    remark: String
                    reviewedBy: String
                    reviewedAt: DateTime
                    payoutRef: String
                    payoutProof: String
                    failReason: String
                    createdAt: DateTime
                }

                type RiderApplicationList {
                    items: [Customer!]!
                    total: Int!
                }

                """骑手合规判定项（P2-5：健康证/保险/背调）"""
                type RiderComplianceItem {
                    key: String!
                    label: String!
                    """ok / expiring / expired / pending / missing / failed"""
                    status: String!
                    expiry: DateTime
                    detail: String
                }

                type RiderComplianceResult {
                    customerId: ID!
                    ok: Boolean!
                    blocked: Boolean!
                    pending: Boolean!
                    items: [RiderComplianceItem!]!
                }

                input RiderComplianceInput {
                    healthCertNo: String
                    healthCertImg: String
                    healthCertExpiry: DateTime
                    insuranceNo: String
                    insuranceExpiry: DateTime
                    """none / pending / passed / failed"""
                    backgroundCheck: String
                }

                type CampusSupportTicket {
                    id: ID!
                    """顾客工单为下单顾客；系统工单（外部运单异常等）为 null"""
                    customerId: ID
                    """来源：customer（顾客提交）/ third_party_exception（外部运单异常自动建单）"""
                    source: String!
                    """值班人管理员 userId（系统工单建单时按本店值班表自动指派；无值班/顾客工单为 null）"""
                    assigneeId: ID
                    customerName: String
                    customerPhone: String
                    orderCode: String
                    """关联订单主键（建单按订单号解析并校验归属；未匹配为 null）"""
                    orderId: ID
                    """关联售后单主键（工单与售后打通）"""
                    afterSalesRequestId: ID
                    """关联售后单当前状态：Pending/Approved/Rejected/Refunded/RefundFailed/Closed 等"""
                    afterSalesState: String
                    afterSalesType: String
                    afterSalesRefundAmount: Int
                    afterSalesActualRefundAmount: Int
                    category: String!
                    content: String!
                    images: [String!]
                    status: String!
                    reply: String
                    repliedAt: DateTime
                    createdAt: DateTime!
                }

                type CampusSupportTicketList {
                    items: [CampusSupportTicket!]!
                    total: Int!
                }

                type CampusCompensationTask {
                    id: ID!
                    orderId: ID!
                    channelId: ID!
                    customerId: ID
                    """coupon=补发补偿券 / notify=补发站内信"""
                    kind: String!
                    dedupeKey: String!
                    status: String!
                    attempts: Int!
                    nextAttemptAt: DateTime
                    lastError: String
                    createdAt: DateTime!
                }

                type CampusCompensationTaskList {
                    items: [CampusCompensationTask!]!
                    total: Int!
                }

                type CampusRiderAppeal {
                    id: ID!
                    riderCustomerId: ID!
                    riderName: String
                    riderPhone: String
                    orderId: ID
                    orderCode: String
                    reason: String!
                    images: [String!]
                    status: String!
                    creditDelta: Int!
                    reviewNote: String
                    reviewedAt: DateTime
                    createdAt: DateTime!
                }

                type CampusRiderAppealList {
                    items: [CampusRiderAppeal!]!
                    total: Int!
                }

                type CampusBlacklistEntry {
                    id: ID!
                    type: String!
                    customerId: ID
                    phone: String
                    reason: String
                    createdBy: String
                    active: Boolean!
                    createdAt: DateTime!
                }

                type CampusBlacklistList {
                    items: [CampusBlacklistEntry!]!
                    total: Int!
                }

                type CampusRemoveResult {
                    ok: Boolean!
                }

                type CampusBlacklistImportResult {
                    added: Int!
                    skipped: Int!
                    invalid: Int!
                }

                """在线客服会话（后台列表行）：带顾客姓名/手机号，免去二次查询"""
                type CampusChatConversation {
                    id: ID!
                    customerId: ID!
                    customerName: String
                    customerPhone: String
                    orderCode: String
                    subject: String
                    status: String!
                    lastMessage: String
                    lastMessageAt: DateTime
                    lastSenderType: String
                    unreadForCustomer: Int!
                    unreadForAdmin: Int!
                    closedAt: DateTime
                    createdAt: DateTime!
                }

                type CampusChatConversationList {
                    items: [CampusChatConversation!]!
                    total: Int!
                }

                """未读角标：conversationCount 待处理会话数，messageCount 未读消息总数"""
                type CampusChatUnread {
                    conversationCount: Int!
                    messageCount: Int!
                }

                type CampusChatMessage {
                    id: ID!
                    conversationId: ID!
                    senderType: String!
                    senderId: ID
                    content: String
                    images: [String!]
                    readAt: DateTime
                    createdAt: DateTime!
                }

                type CampusRiderShift {
                    id: ID!
                    riderCustomerId: ID!
                    realName: String
                    shiftDate: String!
                    startTime: String!
                    endTime: String!
                    note: String
                    onlineMinutes: Int
                    shiftMinutes: Int
                }

                type CampusRiderShiftList {
                    date: String!
                    items: [CampusRiderShift!]!
                }

                input CampusRiderShiftInput {
                    id: ID
                    riderCustomerId: ID!
                    shiftDate: String!
                    startTime: String!
                    endTime: String!
                    note: String
                }

                type CampusRiderOnlineStat {
                    riderCustomerId: ID!
                    realName: String!
                    onlineMinutes: Int!
                }

                type CampusRiderOnlineStatList {
                    date: String!
                    items: [CampusRiderOnlineStat!]!
                }

                type CampusRiderReviewRow {
                    id: ID!
                    riderCustomerId: ID!
                    orderId: ID!
                    rating: Int!
                    tags: [String!]
                    comment: String
                    createdAt: DateTime!
                }

                type CampusRiderRating {
                    riderCustomerId: ID!
                    avgRating: Float!
                    ratingCount: Int!
                }

                type CampusMerchantProduct {
                    productId: ID!
                    name: String!
                    soldOut: Boolean!
                    monthlySales: Int!
                    variantCount: Int!
                    """商品级打包费单价（分/件）；null=沿用店铺配置金额"""
                    packingFee: Int
                    """加料组配置 JSON 字符串（AddonGroupConfig[]）；null=无加料"""
                    addonGroups: String
                    """套餐内容 JSON 字符串（ComboConfig）；null=非套餐商品"""
                    combo: String
                    """每日限量（份）；null=不限"""
                    dailyLimit: Int
                    """每人限购（份）；null=不限"""
                    perUserLimit: Int
                    """今日已售份数（UTC+8 当日已支付订单）"""
                    soldToday: Int!
                    """今日剩余可售份数；null=不限"""
                    remaining: Int
                }

                type CampusMerchantProductList {
                    items: [CampusMerchantProduct!]!
                    total: Int!
                }

                type CampusMerchantSoldOutResult {
                    ok: Boolean!
                    soldOut: Boolean!
                }

                """全店批量沽清结果：count 为本次实际影响的本渠道商品数"""
                type CampusMerchantSoldOutBatchResult {
                    ok: Boolean!
                    soldOut: Boolean!
                    count: Int!
                }

                """沽清次日自动恢复：enabled 为店铺开关，pending 为当前登记的待恢复件数"""
                type CampusSoldOutAutoRestore {
                    enabled: Boolean!
                    pending: Int!
                }

                """商家自动接单（§69）：acceptedToday=本校园日已自动接单数，openNow=当前营业条件是否满足"""
                type CampusMerchantAutoAccept {
                    enabled: Boolean!
                    """下单到自动接单的延迟秒数（0-600）"""
                    delaySeconds: Int!
                    """每日自动接单上限（0=不限）"""
                    dailyLimit: Int!
                    """适用范围路线（R1/R2/R3）"""
                    routes: [String!]!
                    """本校园日已自动接单数"""
                    acceptedToday: Int!
                    """营业时段内且未临时休息（false 时自动接单静默暂停）"""
                    openNow: Boolean!
                    """本店是否开启商家接单确认模式（关闭时订单不产生待接单态）"""
                    merchantConfirmEnabled: Boolean!
                }

                type CampusMerchantPackingFeeResult {
                    ok: Boolean!
                    """保存后的商品级打包费（分/件）；null=沿用店铺配置"""
                    packingFee: Int
                }

                """每日限量/每人限购保存结果（§68）：remaining=null 表示不限"""
                type CampusProductLimitResult {
                    ok: Boolean!
                    dailyLimit: Int
                    perUserLimit: Int
                    soldToday: Int!
                    remaining: Int
                }

                """C 端商品当日额度（§68）：myToday/myRemaining 未登录时为 null"""
                type CampusProductDailyStock {
                    productId: ID!
                    dailyLimit: Int
                    perUserLimit: Int
                    soldToday: Int!
                    remaining: Int
                    myToday: Int
                    myRemaining: Int
                }

                """商品加料组保存结果：addonGroups 为清洗后的 JSON 字符串，null=已清除"""
                type CampusMerchantAddonResult {
                    ok: Boolean!
                    addonGroups: String
                }

                """商品套餐保存结果：combo 为清洗后的 JSON 字符串，null=已清除"""
                type CampusMerchantComboResult {
                    ok: Boolean!
                    combo: String
                }

                type CampusRiderEarningRow {
                    id: ID!
                    orderId: ID!
                    orderCode: String
                    riderCustomerId: ID!
                    riderName: String!
                    """分成金额（分，已含小费折算）"""
                    amount: Int!
                    """其中小费（分，仅展示，不额外叠加）"""
                    tip: Int!
                    """credited / pending / crediting"""
                    status: String!
                    createdAt: DateTime!
                }

                type CampusRiderEarningList {
                    items: [CampusRiderEarningRow!]!
                    total: Int!
                    """筛选条件下全量分成合计（分）"""
                    sumAmount: Int!
                    """筛选条件下全量小费合计（分）"""
                    sumTip: Int!
                }

                type CampusRiderTrackPoint {
                    id: ID!
                    orderId: ID!
                    orderCode: String
                    riderCustomerId: ID!
                    lat: Float!
                    lng: Float!
                    reportedAt: DateTime!
                }

                type CampusRiderTrack {
                    orderId: ID
                    orderCode: String
                    riderCustomerId: ID
                    riderName: String
                    points: [CampusRiderTrackPoint!]!
                    """相邻点位球面直线距离累计（米）"""
                    distanceMeters: Int!
                    """是否因单次上限 5000 点被截断"""
                    truncated: Boolean!
                }

                """广告投放单（P2-3）：商家自助下单 → 模拟支付 → 平台审核 → 按日期投放"""
                type CampusAdCampaign {
                    id: ID!
                    channelId: ID!
                    """广告位：homeBanner（首页横幅）/ shopTop（店铺页顶部）"""
                    slot: String!
                    title: String!
                    imageUrl: String
                    linkUrl: String
                    """投放开始日（YYYY-MM-DD，含当日）"""
                    startDate: String!
                    """投放结束日（YYYY-MM-DD，含当日）"""
                    endDate: String!
                    days: Int!
                    unitPriceFen: Int!
                    totalFen: Int!
                    """pendingPay / pendingReview / running / rejected / cancelled / finished（已结束按日期实时判定）"""
                    status: String!
                    """当前是否在展示窗口内"""
                    live: Boolean!
                    payRef: String
                    paidAt: DateTime
                    reviewNote: String
                    reviewedBy: String
                    reviewedAt: DateTime
                    createdAt: DateTime
                }

                """广告投放单分页（§122）：total 为当前筛选下的总数，items 为当前页"""
                type CampusAdCampaignPage {
                    total: Int!
                    items: [CampusAdCampaign!]!
                }

                type CampusAdSlot {
                    code: String!
                    name: String!
                    """单日单价（分）"""
                    unitPriceFen: Int!
                }

                """智能取餐柜站点（P2-4）：后端只落站点与格口规模，柜机 SDK 待接"""
                type CampusLockerStation {
                    id: ID!
                    channelId: ID!
                    name: String!
                    """柜机位置（如「东区 3 号楼一层大厅」）"""
                    location: String!
                    """服务商编码：self=自建"""
                    provider: String!
                    providerName: String!
                    totalCells: Int!
                    """可用格口（运营手工维护，本轮不接实时库存）"""
                    availableCells: Int!
                    openHours: String
                    pickupGuide: String
                    enabled: Boolean!
                    sort: Int!
                    createdBy: String
                    createdAt: DateTime
                }

                input CampusLockerStationInput {
                    name: String
                    location: String
                    provider: String
                    totalCells: Int
                    availableCells: Int
                    openHours: String
                    pickupGuide: String
                    enabled: Boolean
                    sort: Int
                }

                type CampusUnmannedProvider {
                    code: String!
                    name: String!
                    needsEndpoint: Boolean!
                    needsKey: Boolean!
                }

                """无人配送通道（P2-4 接口占位）：mock=模拟受理，真实厂商需 endpoint + key"""
                type CampusUnmannedChannel {
                    enabled: Boolean!
                    provider: String!
                    providerName: String!
                    providers: [CampusUnmannedProvider!]!
                    endpoint: String
                    """密钥是否已配置（不返回明文）"""
                    keyConfigured: Boolean!
                    needsEndpoint: Boolean!
                    needsKey: Boolean!
                }

                input CampusUnmannedChannelInput {
                    enabled: Boolean
                    provider: String
                    endpoint: String
                    key: String
                }

                type CampusUnmannedDeliveryResult {
                    ok: Boolean!
                    provider: String!
                    providerName: String!
                    """disabled / unconfigured / unsupported / rejected / accepted（accepted 仅 mock 模拟通道）"""
                    status: String!
                    requestNo: String
                    message: String!
                }

                extend type Query {
                    campusZones: [CampusZone!]!
                    campusBuildings(zoneId: ID): [CampusBuilding!]!
                    campusConfig: CampusFulfillmentConfig!
                    campusSlots: [DeliverySlot!]!
                    riderApplications(status: String!, skip: Int, take: Int): RiderApplicationList!
                    campusDispatchBoard: CampusDispatchBoard!
                    campusStoreConfigs: [CampusStoreConfigWithChannel!]!
                    """广告位报价（分/天）"""
                    campusAdSlots: [CampusAdSlot!]!
                    """商家侧：本渠道广告投放单"""
                    campusMerchantAds: [CampusAdCampaign!]!
                    """平台侧：按渠道/状态分页查投放单（skip/take，默认 20、上限 100）"""
                    campusAdCampaigns(status: String, channelId: ID, skip: Int, take: Int): CampusAdCampaignPage!
                    """智能取餐柜（P2-4）：本渠道站点（含停用）"""
                    campusLockerStations: [CampusLockerStation!]!
                    """无人配送通道（P2-4 接口占位）配置"""
                    campusUnmannedChannel: CampusUnmannedChannel!
                    campusMerchantBoard: CampusMerchantBoard!
                    """商家自助经营：门店资料（营业时间/公告/电话/营业状态）"""
                    campusMerchantStoreProfile: MerchantStoreProfile!
                    """商家自助经营数据：今日/近 7 日单量、营业额、客单价、取消退款"""
                    campusMerchantRevenue: CampusMerchantRevenue!
                    """自定义区间逐日经营数据（§89 导出）：from/to 为 YYYY-MM-DD，含起止两日，最多 366 天"""
                    campusMerchantRevenueRange(from: String!, to: String!): [CampusMerchantRevenueDay!]!
                    """今日/区间已完成订单明细（§75 对账）：from/to 为空=今日 0 点至当前"""
                    campusMerchantCompletedOrders(from: String, to: String, take: Int, skip: Int): CampusMerchantCompletedOrders!
                    """退款记录台账（§77）：按渠道聚合退款单，Failed 单单独留痕不计数"""
                    campusMerchantRefunds(from: String, to: String, take: Int, skip: Int): CampusMerchantRefunds!
                    """商家侧顾客联系方式（号码保护）：开启后仅返回脱敏/虚拟号"""
                    campusMerchantCustomerContact(orderId: ID!): CampusPrivacyContact!
                    riderWithdrawals(status: String, skip: Int, take: Int): [RiderWithdrawalRequest!]!
                    campusDeliveryStats(range: String): CampusDeliveryStats!
                    """销售侧经营 BI（P4-1）：今日/7日/30日"""
                    campusSalesStats(range: String, from: String, to: String): CampusSalesStats!
                    campusAddressChanges(status: String, orderId: ID, skip: Int, take: Int): [CampusAddressChangeRow!]!
                    campusAddressChangeStats: CampusAddressChangeStats!
                    campusAdminQuoteAddressChange(orderId: ID!, zoneId: ID!): CampusAddressChangeQuote!
                    campusDynamicPricingPreview: CampusDynamicPricingPreview!
                    campusSupportTickets(status: String, source: String, assigneeId: ID, skip: Int, take: Int): CampusSupportTicketList!
                    """R2 补偿任务列表（失败任务排查；status=pending/done/failed）"""
                    campusCompensationTasks(status: String, skip: Int, take: Int): CampusCompensationTaskList!
                    campusChatConversations(status: String, unreadOnly: Boolean, skip: Int, take: Int): CampusChatConversationList!
                    campusChatUnread: CampusChatUnread!
                    campusAdminChatMessages(conversationId: ID!, afterId: ID, take: Int): [CampusChatMessage!]!
                    campusRiderAppeals(status: String, skip: Int, take: Int): CampusRiderAppealList!
                    campusBlacklist(skip: Int, take: Int): CampusBlacklistList!
                    campusRiderShifts(date: String!): CampusRiderShiftList!
                    campusRiderOnlineStats(date: String): CampusRiderOnlineStatList!
                    campusRiderReviews(riderCustomerId: ID, skip: Int, take: Int): [CampusRiderReviewRow!]!
                    campusRiderRating(riderCustomerId: ID!): CampusRiderRating!
                    campusRiderEarnings(from: String, to: String, riderCustomerId: ID, status: String, orderCode: String, skip: Int, take: Int): CampusRiderEarningList!
                    campusOrderRiderTrack(orderId: ID, orderCode: String): CampusRiderTrack!
                    campusRiderTrack(riderCustomerId: ID!, from: String!, to: String!): CampusRiderTrack!
                    campusMerchantProducts(search: String, skip: Int, take: Int): CampusMerchantProductList!
                    """KDS 出餐屏（P1-4）：待接单/备餐中队列"""
                    campusMerchantKitchenQueue: CampusKitchenQueue!
                    """备餐汇总（§79）：今日待接单/备餐中/已出餐商品份数 + 加料份数"""
                    campusMerchantPrepSummary: [CampusMerchantPrepItem!]!
                    """营业日报（§80）：单日 KPI + 时段分布 + 商品 Top5 + 对比昨日/近 7 日均值"""
                    campusMerchantDailyReport(date: String): CampusMerchantDailyReport!
                    """售后申请清单（§81）：本店渠道订单的售后单，state 为空=全部"""
                    campusMerchantAfterSales(state: String, type: String, orderCode: String, keyword: String, tag: ID, assignee: String, messageKeyword: String, attention: String, minAmount: Int, maxAmount: Int, risk: String, from: String, to: String, skip: Int, take: Int): CampusMerchantAfterSalesList!
                    """售后工作台摘要（§88）：一次请求返回各待办入口计数"""
                    campusMerchantAfterSalesWorkbench: CampusMerchantAfterSalesWorkbench!
                    """售后标签列表（§88）"""
                    campusMerchantAfterSalesTags: [CampusMerchantAfterSalesTag!]!
                    """处理人候选（§89）：本店渠道管理员"""
                    campusMerchantAfterSalesAssignees: [CampusMerchantAfterSalesAssignee!]!
                    """员工处理绩效（§89）：区间内按操作人统计，区间最长一年"""
                    campusMerchantAfterSalesStaffStats(from: String!, to: String!): [CampusMerchantAfterSalesStaffRow!]!
                    """本店黑名单列表（§90）：仅 active 记录"""
                    campusMerchantAfterSalesBlacklist(skip: Int, take: Int): [CampusMerchantAfterSalesBlacklistEntry!]!
                    """处理人负载（§91）：按处理人统计未完结单"""
                    campusMerchantAfterSalesAssigneeLoad: [CampusMerchantAfterSalesAssigneeLoad!]!
                    """导出选中售后单 CSV（§91）：上限 500 单，kind=requests|refunds"""
                    campusMerchantAfterSalesExportByIds(ids: [ID!]!, kind: String!): String!
                    """售后详情（§81）：协商留言 + 状态时间线 + 退款失败留痕"""
                    campusMerchantAfterSalesDetail(id: ID!): CampusMerchantAfterSalesDetail!
                    """售后处理统计（§81）：待处理/超时/今日处理量/今日退款额"""
                    campusMerchantAfterSalesStats: CampusMerchantAfterSalesStats!
                    """售后报表（§83）：区间内量/退款/超时与逐日趋势"""
                    campusMerchantAfterSalesReport(from: String!, to: String!): CampusMerchantAfterSalesReport!
                    """商品维度售后统计（§92）：Top 商品售后单量/退款额/售后率"""
                    campusMerchantAfterSalesProductReport(from: String!, to: String!, limit: Int): [CampusMerchantAfterSalesProductRow!]!
                    """售后原因分布（§93）：区间内按原因聚合单量/退款/占比与环比"""
                    campusMerchantAfterSalesReasonReport(from: String!, to: String!, limit: Int): [CampusMerchantAfterSalesReasonRow!]!
                    """顾客售后档案（§93）：本店维度历史售后、退款与拉黑状态"""
                    campusMerchantAfterSalesCustomerProfile(customerId: ID!): CampusMerchantAfterSalesCustomerProfile!
                    """售后处理凭证（§93）：门店留存/交接用纯文本凭条"""
                    campusMerchantAfterSalesPrintSlip(id: ID!): String!
                    """批量打印售后凭证（§94）：上限 50 单，返回逐单凭条"""
                    campusMerchantAfterSalesPrintSlips(ids: [ID!]!): [String!]!
                    """退款后满意度汇总（§93）：均分/分档/低分待跟进"""
                    campusMerchantAfterSalesReviewSummary(from: String!, to: String!): CampusMerchantAfterSalesReviewSummary!
                    """售后寄回地址（§83）：本店渠道配置"""
                    campusMerchantAfterSalesReturnAddress: String!
                    """售后规则（§84）：处理时限/超时自动同意/退款自动重试"""
                    campusMerchantAfterSalesRules: CampusMerchantAfterSalesRules!
                    """退款流水（§84）：按退款时间倒序分页"""
                    campusMerchantAfterSalesRefunds(from: String, to: String, skip: Int, take: Int): CampusMerchantAfterSalesRefundList!
                    """售后自动化任务（§85）：本店超时/自动同意/退款重试任务"""
                    campusMerchantAfterSalesTasks(status: String, skip: Int, take: Int): CampusMerchantAfterSalesTaskList!
                    """导出售后明细/退款流水/升级工单 CSV（§85、§97）：kind=requests|refunds|escalations，可选筛选"""
                    campusMerchantAfterSalesExport(from: String!, to: String!, kind: String!, state: String, type: String, keyword: String, assigneeUserId: String): String!
                    """高频售后顾客 Top N（§85）：附黑名单状态"""
                    campusMerchantAfterSalesTopCustomers(from: String!, to: String!, limit: Int): [CampusMerchantAfterSalesTopCustomer!]!
                    """售后内部备注（§86）：仅本店可见"""
                    campusMerchantAfterSalesNotes(id: ID!): [CampusMerchantAfterSalesNote!]!
                    """快捷回复模板（§87、§97）：本店渠道，可按分类/关键词检索"""
                    campusMerchantAfterSalesReplyTemplates(category: String, keyword: String): [CampusMerchantAfterSalesReplyTemplate!]!
                    """商品维度售后分析（§98）：区间内按商品聚合售后率与退款额"""
                    campusMerchantAfterSalesProductAnalysis(from: String!, to: String!): CampusMerchantAfterSalesProductRateAnalysis!
                    """退货物流轨迹（§98）：运单信息 + 系统/商家节点合并时间线"""
                    campusMerchantAfterSalesReturnLogistics(id: ID!): CampusMerchantAfterSalesReturnLogistics!
                    """售后自动分流规则（§98）：按优先级升序"""
                    campusMerchantAfterSalesAutoRules: [CampusMerchantAfterSalesAutoRule!]!
                    """大额退款复核队列（§99）：默认待复核，status=Pending|Approved|Rejected"""
                    campusMerchantAfterSalesRefundReviews(status: String): [CampusMerchantAfterSalesRefundReview!]!
                    """智能话术推荐（§99）：按售后原因/类型匹配本店快捷回复模板"""
                    campusMerchantAfterSalesSuggestedReplies(id: ID!): [CampusMerchantAfterSalesSuggestedReply!]!
                    """售后操作审计检索（§100）：按时间/动作/处理人筛选"""
                    campusMerchantAfterSalesAuditLogs(from: String, to: String, action: String, actorUserId: ID, take: Int, skip: Int): [CampusMerchantAfterSalesAuditRow!]!
                    """售后操作审计导出（§100）：CSV"""
                    campusMerchantAfterSalesAuditExport(from: String, to: String, action: String, actorUserId: ID): String!
                    """售后值班表（§100）"""
                    campusMerchantAfterSalesDutyRoster: [CampusMerchantAfterSalesDutyEntry!]!
                    """补偿挽留方案列表（§100）"""
                    campusMerchantAfterSalesCompensationPlans: [CampusMerchantAfterSalesCompensationPlan!]!
                    """最近云打印任务（P1-4）"""
                    campusMerchantPrintJobs(limit: Int): [CampusPrintJob!]!
                    """沽清次日自动恢复（§66）：开关与待恢复件数"""
                    campusMerchantSoldOutAutoRestore: CampusSoldOutAutoRestore!
                    """商家自动接单设置（§69）"""
                    campusMerchantAutoAccept: CampusMerchantAutoAccept!
                }

                type CampusDeliveryStatsKpi {
                    totalOrders: Int!
                    onTimeRate: Float!
                    avgDeliveryMinutes: Float!
                    timeoutCompensated: Int!
                }

                type CampusDeliveryDailyPoint {
                    date: String!
                    orders: Int!
                    onTimeRate: Float!
                }

                type CampusDeliveryStage {
                    key: String!
                    label: String!
                    avgMinutes: Float!
                }

                type CampusDeliveryAttribution {
                    merchant: Int!
                    rider: Int!
                    platform: Int!
                }

                type CampusDeliveryStoreLine {
                    channelId: ID!
                    channelName: String!
                    orders: Int!
                    onTimeRate: Float!
                }

                type CampusDeliveryStats {
                    range: String!
                    windowStart: DateTime!
                    kpis: CampusDeliveryStatsKpi!
                    dailyTrend: [CampusDeliveryDailyPoint!]!
                    stages: [CampusDeliveryStage!]!
                    attribution: CampusDeliveryAttribution!
                    storeComparison: [CampusDeliveryStoreLine!]!
                }

                type CampusSalesKpi {
                    orders: Int!
                    gmvFen: Float!
                    aovFen: Float!
                    customers: Int!
                    newCustomers: Int!
                    repurchaseRate: Float!
                }

                type CampusSalesCompare {
                    ordersPct: Float!
                    gmvPct: Float!
                    aovPct: Float!
                    repurchaseRatePct: Float!
                }

                type CampusSalesHourPoint {
                    hour: Int!
                    orders: Int!
                    gmvFen: Float!
                }

                type CampusSalesDayPoint {
                    date: String!
                    orders: Int!
                    gmvFen: Float!
                }

                type CampusSalesProduct {
                    productId: ID!
                    name: String!
                    quantity: Int!
                    gmvFen: Float!
                    """star 明星 / traffic 引流 / premium 利润 / slow 滞销"""
                    quadrant: String!
                    """所属分类（商品结构导出按分类筛选用）"""
                    categories: [CampusSalesProductCategory!]!
                }

                type CampusSalesProductCategory {
                    id: ID!
                    name: String!
                }

                type CampusSalesCohorts {
                    once: Int!
                    twiceToFour: Int!
                    loyal: Int!
                }

                type CampusSalesStats {
                    range: String!
                    windowStart: DateTime!
                    kpis: CampusSalesKpi!
                    prev: CampusSalesKpi!
                    compare: CampusSalesCompare!
                    hourlyHeat: [CampusSalesHourPoint!]!
                    dailyTrend: [CampusSalesDayPoint!]!
                    products: [CampusSalesProduct!]!
                    cohorts: CampusSalesCohorts!
                    medianQuantity: Float!
                    medianGmvFen: Float!
                }

                type CampusAddressChangeRow {
                    id: ID!
                    orderId: ID!
                    orderCode: String!
                    customerId: ID
                    fromZone: String!
                    fromBuilding: String!
                    fromDetail: String
                    toZone: String!
                    toBuilding: String!
                    toDetail: String
                    oldFee: Int!
                    newFee: Int!
                    diff: Int!
                    status: String!
                    settledAt: DateTime
                    settleAction: String
                    """结清凭证：补收收款方式/流水号，或退款说明"""
                    settleNote: String
                    """实际退款单 id（财务对账）"""
                    refundId: ID
                    source: String
                    reason: String
                    changedBy: ID
                    createdAt: DateTime!
                }

                """改址差额试算（不落台账）"""
                type CampusAddressChangeQuote {
                    oldFee: Int!
                    newFee: Int!
                    diff: Int!
                    zoneId: ID!
                    zoneName: String!
                    buildings: [CampusBuilding!]!
                }

                type CampusPricingBreakdownItem {
                    key: String!
                    label: String!
                    fee: Int!
                }

                type CampusDynamicPricingZoneQuote {
                    zoneId: ID!
                    zoneName: String!
                    baseFee: Int!
                    price: Int!
                    addFee: Int!
                    breakdown: [CampusPricingBreakdownItem!]!
                }

                type CampusDynamicPricingSupply {
                    backlogThreshold: Int!
                    riderThreshold: Int
                    addFee: Int!
                }

                type CampusDynamicPricingPeakWindow {
                    label: String
                    start: String!
                    end: String!
                    addFee: Int!
                }

                type CampusDynamicPricingBaseQuote {
                    key: String!
                    configured: Boolean!
                    baseFee: Int!
                    price: Int!
                    addFee: Int!
                    breakdown: [CampusPricingBreakdownItem!]!
                }

                """动态计价试算预览：当前供需 + 各分区加价拆解"""
                type CampusDynamicPricingPreview {
                    at: DateTime!
                    enabled: Boolean!
                    backlog: Int!
                    onlineRiders: Int!
                    manualMultiplier: Float!
                    maxAddFee: Int!
                    supply: CampusDynamicPricingSupply
                    peakWindows: [CampusDynamicPricingPeakWindow!]!
                    zones: [CampusDynamicPricingZoneQuote!]!
                    """R5 跑腿起步价口径（未配置按默认 2 元）"""
                    errand: CampusDynamicPricingBaseQuote!
                    """R2 第三方到校基价口径（未配置返回 null，沿用店铺普通快递运费）"""
                    thirdParty: CampusDynamicPricingBaseQuote
                }

                type CampusAddressChangeStats {
                    total: Int!
                    pendingCount: Int!
                    pendingCollect: Int!
                    pendingRefund: Int!
                }

                type CampusAddressChangeResult {
                    diff: Int!
                    oldFee: Int!
                    newFee: Int!
                    fromZone: String!
                    toZone: String!
                    recordId: ID!
                }

                extend type Mutation {
                    campusCreateZone(name: String!, fee: Int!): CampusZone!
                    """分区改名/改运费（渠道隔离）"""
                    campusUpdateZone(id: ID!, name: String, fee: Int): CampusZone!
                    campusCreateBuilding(name: String!, zoneId: ID!, detail: String, lat: Float, lng: Float): CampusBuilding!
                    campusUpdateBuilding(id: ID!, input: CampusBuildingPatchInput!): CampusBuilding!
                    """删除宿舍楼（有订单引用时拒绝）"""
                    campusDeleteBuilding(id: ID!): Boolean!
                    campusUpdateConfig(input: CampusFulfillmentConfigInput!): CampusFulfillmentConfig!
                    campusCreateSlot(input: DeliverySlotInput!): DeliverySlot!
                    campusUpdateSlot(id: ID!, input: DeliverySlotUpdateInput!): DeliverySlot!
                    campusSetRiderStatus(customerId: ID!, status: String!): CampusSetRiderStatusResult!
                    """骑手合规登记（P2-5：健康证/保险/背调），返回最新合规判定"""
                    campusUpdateRiderCompliance(customerId: ID!, input: RiderComplianceInput!): RiderComplianceResult!
                    campusAssignOrder(orderId: ID!, riderCustomerId: ID!): CampusDispatchResult!
                    campusBackToHall(orderId: ID!, note: String): CampusDispatchResult!
                    campusHandleException(orderId: ID!, action: String!, amount: Int, couponTemplateId: ID, note: String): CampusHandleExceptionResult!
                    campusEnsureErrandProducts: CampusErrandProductResult!
                    campusUpdateStoreConfig(channelId: ID!, input: CampusStoreConfigInput!): CampusStoreConfigWithChannel!
                    """商家下单广告（按天计费，下单即固化单价与总价，状态 pendingPay）"""
                    campusMerchantCreateAd(slot: String!, title: String!, startDate: String!, endDate: String!, imageUrl: String, linkUrl: String): CampusAdCampaign!
                    """商家支付广告费（模拟支付，转待审核；重复调用幂等）"""
                    campusMerchantPayAd(id: ID!): CampusAdCampaign!
                    """商家取消广告投放（仅未支付/待审核可取消）"""
                    campusMerchantCancelAd(id: ID!): CampusAdCampaign!
                    """平台审核广告：通过转投放中，驳回须填原因"""
                    campusReviewAd(id: ID!, approve: Boolean!, note: String): CampusAdCampaign!
                    """智能取餐柜（P2-4）：新增站点"""
                    campusCreateLockerStation(input: CampusLockerStationInput!): CampusLockerStation!
                    """智能取餐柜：编辑站点（只改传入字段）"""
                    campusUpdateLockerStation(id: ID!, input: CampusLockerStationInput!): CampusLockerStation!
                    """智能取餐柜：删除站点"""
                    campusDeleteLockerStation(id: ID!): Boolean!
                    """无人配送通道：保存配置（endpoint/key 传空串 = 清空）"""
                    campusUpdateUnmannedChannel(input: CampusUnmannedChannelInput!): CampusUnmannedChannel!
                    """无人配送调用占位：mock 模拟受理并返回 MOCK 单号；真实厂商未接入返回 unsupported，不下发运单"""
                    campusRequestUnmannedDelivery(orderId: ID!): CampusUnmannedDeliveryResult!
                    campusSettleAddressChange(id: ID!, action: String!, note: String): CampusAddressChangeRow!
                    """运营代客改址：取货后也可代改，必须填写原因"""
                    campusAdminChangeDeliveryAddress(orderId: ID!, zoneId: ID!, buildingId: ID!, detail: String, reason: String!): CampusAddressChangeResult!
                    campusEnsureDefaultShippingProfile(channelId: ID!): CampusEnsureProfileResult!
                    """设置商品级打包费（分/件）；传 null 清除，回落到店铺配置金额"""
                    campusMerchantSetProductPackingFee(productId: ID!, packingFee: Int): CampusMerchantPackingFeeResult!
                    """每日限量 / 每人限购（§68）：传 null 或 0 = 不限"""
                    campusMerchantSetProductLimit(productId: ID!, dailyLimit: Int, perUserLimit: Int): CampusProductLimitResult!
                    """设置商品加料组（P1-2）：groups 为 AddonGroupConfig 的 JSON 字符串数组，空数组清除"""
                    campusMerchantSetProductAddonGroups(productId: ID!, groups: [String!]!): CampusMerchantAddonResult!
                    """设置商品套餐内容（P1-2）：combo 为 ComboConfig 的 JSON 字符串，null 清除"""
                    campusMerchantSetProductCombo(productId: ID!, combo: String): CampusMerchantComboResult!
                    campusMerchantAcceptOrder(orderId: ID!): CampusMerchantOpResult!
                    campusMerchantCookingDone(orderId: ID!): CampusMerchantOpResult!
                    """批量接单（§73）：逐单走既有接单状态机，失败单跳过并在 failed 中回报"""
                    campusMerchantBatchAcceptOrders(orderIds: [ID!]!): CampusMerchantBatchResult!
                    """批量出餐（§73）：逐单走出餐分流，失败单跳过并在 failed 中回报"""
                    campusMerchantBatchCookingDoneOrders(orderIds: [ID!]!): CampusMerchantBatchResult!
                    campusMerchantRejectOrder(orderId: ID!, reason: String!): CampusMerchantOpResult!
                    """商家发起退款（§76）：已送达订单整单/部分退款，amount 为分"""
                    campusMerchantRefundOrder(orderId: ID!, amount: Int!, reason: String!): CampusMerchantRefundResult!
                    """同意售后（§81）：仅退款单直接链式退款到账"""
                    campusMerchantAfterSalesApprove(id: ID!): CampusMerchantAfterSalesItem!
                    """驳回售后（§81）：reason 必填，顾客 C 端可见"""
                    campusMerchantAfterSalesReject(id: ID!, reason: String!): CampusMerchantAfterSalesItem!
                    """商家协商留言（§81）：与顾客售后详情双向互通，Closed 后禁言"""
                    campusMerchantAfterSalesReply(id: ID!, content: String!, images: [String!]): CampusMerchantAfterSalesMessage!
                    """商家确认收到退货（§82）：Returning → Received，可传实收数量与收货备注"""
                    campusMerchantAfterSalesConfirmReturn(id: ID!, receivedQuantity: Int, note: String): CampusMerchantAfterSalesItem!
                    """售后退款失败重试（§82）：仅 RefundFailed，30 秒内同单一次"""
                    campusMerchantAfterSalesRetryRefund(id: ID!): CampusMerchantAfterSalesItem!
                    """换货发货（§83）：Received → ExchangeShipped，仅换货单"""
                    campusMerchantAfterSalesExchangeShip(id: ID!, trackingNo: String!, carrier: String): CampusMerchantAfterSalesItem!
                    """批量同意（§83）：单次最多 50 条，逐单返回结果"""
                    campusMerchantAfterSalesBatchApprove(ids: [ID!]!): [CampusMerchantAfterSalesBatchResult!]!
                    """批量驳回（§83）：整批共用一个原因，单次最多 50 条"""
                    campusMerchantAfterSalesBatchReject(ids: [ID!]!, reason: String!): [CampusMerchantAfterSalesBatchResult!]!
                    """保存售后寄回地址（§83）"""
                    campusMerchantUpdateAfterSalesReturnAddress(address: String!): Boolean!
                    """保存售后规则（§84）：超时提醒 1-168h，自动同意 0-168h，自动重试 0-5 次"""
                    campusMerchantUpdateAfterSalesRules(timeoutHours: Int, autoApproveHours: Int, refundAutoRetry: Int, firstResponseTargetHours: Int, resolveTargetHours: Int, dueSoonHours: Int, refundReviewThreshold: Int): CampusMerchantAfterSalesRules!
                    """售后单转交（§99）：转给另一位本店管理员，原因必填并推送店铺群"""
                    campusMerchantAfterSalesTransfer(id: ID!, userId: ID!, reason: String!): CampusMerchantAfterSalesItem!
                    """大额退款复核（§99）：申请人以外的管理员确认同意或驳回"""
                    campusMerchantAfterSalesResolveRefundReview(id: ID!, approve: Boolean!, note: String): CampusMerchantAfterSalesRefundReview!
                    """商家关闭待处理售后（§84）：Pending → Closed，原因必填"""
                    campusMerchantAfterSalesClose(id: ID!, reason: String!): CampusMerchantAfterSalesItem!
                    """商家催办顾客（§84）：60 秒内同单一次，站内信提醒"""
                    campusMerchantAfterSalesRemind(id: ID!, note: String): CampusMerchantAfterSalesItem!
                    """立即执行售后自动化任务（§85）：重置到期后复用任务锁执行"""
                    campusMerchantAfterSalesRunTask(id: ID!): CampusMerchantAfterSalesTask!
                    """一键拉黑高频售后顾客（§85）"""
                    campusMerchantBlacklistAfterSalesCustomer(customerId: ID!, reason: String): Boolean!
                    """新增售后内部备注（§86）：顾客不可见"""
                    campusMerchantAfterSalesAddNote(id: ID!, content: String!): CampusMerchantAfterSalesNote!
                    """删除售后内部备注（§86）"""
                    campusMerchantAfterSalesDeleteNote(id: ID!, noteId: ID!): Boolean!
                    """批量催办顾客（§86）：单次最多 20 条，逐单返回结果"""
                    campusMerchantAfterSalesBatchRemind(ids: [ID!]!, note: String): [CampusMerchantAfterSalesBatchResult!]!
                    """批量内部备注（§92）：上限 50 单，逐单结果"""
                    campusMerchantAfterSalesBatchNote(ids: [ID!]!, content: String!): [CampusMerchantAfterSalesBatchResult!]!
                    """标记低分已跟进（§93）"""
                    campusMerchantAfterSalesReviewFollowUp(id: ID!): Boolean!
                    """线下退款登记（§94）：现金/转账等线下退款后登记，金额单位分"""
                    campusMerchantAfterSalesOfflineRefund(id: ID!, amount: Int!, method: String!, note: String): CampusMerchantAfterSalesOfflineRefundResult!
                    """标记售后风险（§94）：争议/异常单"""
                    campusMerchantAfterSalesRiskFlag(id: ID!, reason: String): CampusMerchantAfterSalesItem!
                    """解除售后风险标记（§94）"""
                    campusMerchantAfterSalesRiskClear(id: ID!): CampusMerchantAfterSalesItem!
                    """新增顾客回访记录（§94）：method=phone/wechat/onsite/other，result=reached/unreached/refused/other"""
                    campusMerchantAfterSalesAddFollowUp(id: ID!, method: String!, result: String!, note: String, nextAt: String): [CampusMerchantAfterSalesFollowUp!]!
                    """暂停售后 SLA 计时（§95/§96）：等待顾客补充资料/回寄期间不计超时/临期，原因必填"""
                    campusMerchantAfterSalesPauseSla(id: ID!, reason: String!): CampusMerchantAfterSalesItem!
                    """恢复售后 SLA 计时（§95）：暂停时长累计后顺延截止时间"""
                    campusMerchantAfterSalesResumeSla(id: ID!): CampusMerchantAfterSalesItem!
                    """升级平台仲裁（§96）：商家无法自行处理时转平台客服，priority=normal/urgent"""
                    campusMerchantAfterSalesEscalate(id: ID!, reason: String!, priority: String): [CampusMerchantAfterSalesEscalation!]!
                    """关闭平台仲裁工单（§96）：填写处理结论后置为 Resolved"""
                    campusMerchantAfterSalesEscalationResolve(id: ID!, resolution: String): [CampusMerchantAfterSalesEscalation!]!
                    """批量关闭售后单（§95）：单批上限 50，逐单返回结果"""
                    campusMerchantAfterSalesBatchClose(ids: [ID!]!, reason: String!): [CampusMerchantAfterSalesBatchResult!]!
                    """保存快捷回复模板（§87、§97）：id 为空=新增，单店上限 30 条，可设分类/关键词/排序"""
                    campusMerchantSaveAfterSalesReplyTemplate(id: ID, content: String!, category: String, keywords: String, sortOrder: Int): CampusMerchantAfterSalesReplyTemplate!
                    """删除快捷回复模板（§87）"""
                    campusMerchantDeleteAfterSalesReplyTemplate(id: ID!): Boolean!
                    """登记退货物流节点（§98）：status=picked_up/in_transit/delivered/exception"""
                    campusMerchantAfterSalesRecordReturnLogistics(id: ID!, status: String!, description: String): CampusMerchantAfterSalesReturnLogistics!
                    """整体替换售后值班表（§100）：entries 为 JSON [{weekday,startMin,endMin,userId}]"""
                    campusMerchantSetAfterSalesDutyRoster(entries: String!): [CampusMerchantAfterSalesDutyEntry!]!
                    """保存补偿方案（§100）：id 为空=新增，refundAmount 单位分"""
                    campusMerchantSaveAfterSalesCompensationPlan(id: ID, name: String!, refundAmount: Int!, couponTemplateId: String, note: String, enabled: Boolean): [CampusMerchantAfterSalesCompensationPlan!]!
                    """删除补偿方案（§100）"""
                    campusMerchantDeleteAfterSalesCompensationPlan(id: ID!): [CampusMerchantAfterSalesCompensationPlan!]!
                    """一键发放补偿挽留（§100）：部分退款 + 优惠券，随后关闭售后单"""
                    campusMerchantAfterSalesApplyCompensation(id: ID!, planId: ID!): CampusMerchantAfterSalesCompensationResult!
                    """保存售后自动分流规则（§98）：id 为空=新增，action=approve/reject/escalate"""
                    campusMerchantSaveAfterSalesAutoRule(id: ID, name: String!, action: String!, priority: Int, enabled: Boolean, matchType: String, matchReason: String, minAmount: Int, maxAmount: Int, rejectReason: String): CampusMerchantAfterSalesAutoRule!
                    """删除售后自动分流规则（§98）"""
                    campusMerchantDeleteAfterSalesAutoRule(id: ID!): Boolean!
                    """手动排程退款重试（§87）：仅 RefundFailed，复位任务 1 分钟后执行"""
                    campusMerchantAfterSalesScheduleRefundRetry(id: ID!): CampusMerchantAfterSalesTask!
                    """保存售后标签（§88）：id 为空=新增，单店上限 20 个"""
                    campusMerchantSaveAfterSalesTag(id: ID, name: String!): CampusMerchantAfterSalesTag!
                    """删除售后标签（§88）"""
                    campusMerchantDeleteAfterSalesTag(id: ID!): Boolean!
                    """设置售后单标签（§88）：整体替换，最多 5 个"""
                    campusMerchantSetAfterSalesTags(id: ID!, tagIds: [ID!]!): [String!]!
                    """指派处理人（§89）：userId 为空=取消指派，仅本店渠道管理员"""
                    campusMerchantAfterSalesAssign(id: ID!, userId: ID): CampusMerchantAfterSalesItem!
                    """批量打标签（§89）：上限 50 单，逐单返回结果"""
                    campusMerchantAfterSalesBatchTag(ids: [ID!]!, tagIds: [ID!]!): [CampusMerchantAfterSalesBatchResult!]!
                    """解除本店顾客拉黑（§89）"""
                    campusMerchantUnblacklistAfterSalesCustomer(customerId: ID!): Boolean!
                    """批量指派处理人（§90）：userId 为空=批量取消，逐单返回结果"""
                    campusMerchantAfterSalesBatchAssign(ids: [ID!]!, userId: ID): [CampusMerchantAfterSalesBatchResult!]!
                    campusMerchantSetPaused(paused: Boolean!): CampusMerchantOpResult!
                    """商家自助修改门店资料：营业时间（Channel 自定义字段）/公告/电话，仅本渠道"""
                    campusMerchantUpdateStore(businessHours: String, storeNotice: String, storePhone: String): MerchantStoreProfile!
                    """信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案，文案留空=回落 C 端默认"""
                    campusMerchantUpdateTrustCopy(qualityEnabled: Boolean, qualityText: String, serviceEnabled: Boolean, serviceText: String, timeEnabled: Boolean, timeText: String): MerchantStoreProfile!
                    """每日日报推送设置（§86）：enabled=开关，time=HH:MM（空=21:30）"""
                    campusMerchantUpdateDailyPush(enabled: Boolean!, time: String): MerchantStoreProfile!
                    """售后月度摘要推送（§95）：每月指定日（1-28）把上月售后汇总推到店铺群"""
                    campusMerchantUpdateAfterSalesMonthlyPush(enabled: Boolean!, day: Int, time: String): MerchantStoreProfile!
                    """售后自动化设置（§96）：自动分配 + 异常预警；仅传需要修改的项，阈值 0=关闭该项"""
                    campusMerchantUpdateAfterSalesAutomation(autoAssignEnabled: Boolean, autoAssignMax: Int, alertEnabled: Boolean, alertRefundRate: Int, alertOverdueCount: Int): MerchantStoreProfile!
                    """营业日历（§70）：dates 为 JSON：[{date:'YYYY-MM-DD', note?}]，空=关闭"""
                    campusMerchantSetClosureDates(dates: String): MerchantStoreProfile!
                    campusMerchantMarkPrinted(orderId: ID!): CampusMerchantOpResult!
                    """顾客催单「已知晓」（§78）：商家确认后解除工作台/出餐屏催单提醒"""
                    campusMerchantAckUrge(orderId: ID!): CampusMerchantOpResult!
                    """云打印一张小票（P1-4）：后端签名直连服务商，成功回写打印时间"""
                    campusMerchantCloudPrint(orderId: ID!): CampusPrintResult!
                    """云打印连通性测试（不占用订单）"""
                    campusMerchantCloudPrintTest: CampusPrintResult!
                    campusMerchantDispatchExternal(orderId: ID!, provider: String!): CampusExternalDelivery!
                    campusMerchantCancelExternal(orderId: ID!, reason: String): CampusExternalCancelResult!
                    """运营中心推送/重推外部快递"""
                    campusAdminDispatchExternal(orderId: ID!, provider: String!): CampusExternalDelivery!
                    """运营中心取消外部快递"""
                    campusAdminCancelExternal(orderId: ID!, reason: String): CampusExternalCancelResult!
                    campusMerchantAcceptOwned(orderId: ID!): CampusMerchantOpResult!
                    campusMerchantMarkHandoverArrived(orderId: ID!): CampusFirstLegResult!
                    campusMerchantMarkOwnedArrived(orderId: ID!): CampusFirstLegResult!
                    approveRiderWithdraw(id: ID!, remark: String, payoutRef: String, payoutProof: String): RiderWithdrawalRequest!
                    rejectRiderWithdraw(id: ID!, remark: String): RiderWithdrawalRequest!
                    """打款失败回退：PAID → FAILED 并退回骑手余额"""
                    campusMarkWithdrawFailed(id: ID!, reason: String!): RiderWithdrawalRequest!
                    campusReplySupportTicket(id: ID!, reply: String, status: String): CampusSupportTicket!
                    """工单手工关联售后单（同一店铺且同一订单；建单自动关联未命中时使用）"""
                    campusLinkSupportTicketAfterSales(id: ID!, afterSalesRequestId: ID!): CampusSupportTicket!
                    """R2 手动重试补偿任务（仅 failed/pending 可重置；done 不允许）"""
                    campusRetryCompensationTask(id: ID!): Boolean!
                    campusReplyChat(conversationId: ID!, content: String, images: [String!]): CampusChatMessage!
                    campusCloseChatConversation(conversationId: ID!): CampusChatConversation!
                    campusReviewRiderAppeal(id: ID!, approve: Boolean!, creditDelta: Int, note: String): CampusRiderAppeal!
                    campusAddBlacklist(type: String!, value: String!, reason: String): CampusBlacklistEntry!
                    campusImportBlacklist(type: String!, values: [String!]!, reason: String): CampusBlacklistImportResult!
                    campusRemoveBlacklist(id: ID!): CampusRemoveResult!
                    campusSaveRiderShift(input: CampusRiderShiftInput!): CampusRiderShift!
                    campusDeleteRiderShift(id: ID!): CampusRemoveResult!
                    campusMerchantSetProductSoldOut(productId: ID!, soldOut: Boolean!): CampusMerchantSoldOutResult!
                    campusMerchantSetAllProductsSoldOut(soldOut: Boolean!): CampusMerchantSoldOutBatchResult!
                    """沽清次日自动恢复（§66）：开关；开启后每日 04:00 把全店沽清批次恢复在售"""
                    campusMerchantSetSoldOutAutoRestore(enabled: Boolean!): CampusSoldOutAutoRestore!
                    """商家自动接单（§69）：营业中按延迟秒数自动确认新单，超每日上限退回人工"""
                    campusMerchantUpdateAutoAccept(enabled: Boolean!, delaySeconds: Int, dailyLimit: Int, routes: [String!]): CampusMerchantAutoAccept!
                }

                type CampusMerchantOpResult {
                    ok: Boolean!
                }

                """批量操作结果（§73）：ok=成功单数；failed=失败单明细（逐单跳过，不影响已成功单）"""
                type CampusMerchantBatchResult {
                    ok: Int!
                    failed: [CampusMerchantBatchFailure!]!
                }

                type CampusMerchantBatchFailure {
                    orderId: ID!
                    """失败原因（如「订单状态已变更，请刷新」）"""
                    message: String!
                }

                """外部快递推送结果；already=true 表示重复推送（幂等）"""
                type CampusExternalDelivery {
                    ok: Boolean!
                    provider: String
                    thirdPartyNo: String
                    already: Boolean
                }

                type CampusExternalCancelResult {
                    ok: Boolean!
                    reason: String
                    skipped: Boolean
                }

                """第一段完成结果；done=true 表示订单已直送完成（R3）"""
                type CampusFirstLegResult {
                    ok: Boolean!
                    done: Boolean!
                }

                type PaymentTimeoutTask {
                    id: ID!
                    orderId: ID!
                    type: String!
                    status: String!
                    dueAt: DateTime!
                    retryCount: Int!
                    lastError: String
                }

                type PaymentTimeoutTaskRow {
                    id: ID!
                    orderId: ID!
                    channelId: ID!
                    orderCode: String
                    orderState: String
                    type: String!
                    status: String!
                    dueAt: DateTime!
                    retryCount: Int!
                    lastError: String
                }

                type PaymentTimeoutTaskList {
                    items: [PaymentTimeoutTaskRow!]!
                    total: Int!
                }

                type PaymentTimeoutStats {
                    todayRemind: Int!
                    todayCancel: Int!
                    totalFailed: Int!
                    pendingOverdue: Int!
                }

                extend type Query {
                    paymentTimeoutTasks(status: String, type: String, from: DateTime, to: DateTime, skip: Int, take: Int): PaymentTimeoutTaskList!
                    paymentTimeoutStats: PaymentTimeoutStats!
                }

                extend type Mutation {
                    executePaymentTimeoutTask(id: ID!): PaymentTimeoutTask!
                    resendPaymentTimeoutRemind(taskId: ID!): Boolean!
                    runPaymentTimeoutCompensation: Int!
                }

                """P4-4 系统监控：单事件计数（Top 事件榜）"""
                type CampusEventCount {
                    name: String!
                    count: Int!
                }

                """P4-4 近 7 日趋势点（按校园自然日）"""
                type CampusTrackDayPoint {
                    date: String!
                    events: Int!
                    errors: Int!
                }

                type CampusTrackEventStats {
                    todayEvents: Int!
                    totalEvents: Int!
                    todayErrors: Int!
                    totalErrors: Int!
                    """今日去重顾客数（游客不计）"""
                    affectedUsers: Int!
                    trend: [CampusTrackDayPoint!]!
                    topEvents: [CampusEventCount!]!
                }

                type CampusTrackEvent implements Node {
                    id: ID!
                    eventName: String!
                    page: String
                    sessionId: String
                    customerId: ID
                    """事件属性原始 JSON"""
                    props: String
                    createdAt: DateTime!
                }

                type CampusTrackEventList implements PaginatedList {
                    items: [CampusTrackEvent!]!
                    totalItems: Int!
                }

                type CampusErrorReport implements Node {
                    id: ID!
                    """c-end / admin"""
                    source: String!
                    """error / warn"""
                    level: String!
                    message: String!
                    stack: String
                    page: String
                    url: String
                    customerId: ID
                    createdAt: DateTime!
                }

                type CampusErrorReportList implements PaginatedList {
                    items: [CampusErrorReport!]!
                    totalItems: Int!
                }

                extend type Query {
                    campusTrackEventStats: CampusTrackEventStats!
                    campusTrackEventList(eventName: String, skip: Int, take: Int): CampusTrackEventList!
                    campusErrorReportList(level: String, skip: Int, take: Int): CampusErrorReportList!
                }
            `;
        },
        resolvers: [CampusConfigAdminResolver, RiderAdminResolver, RiderLedgerAdminResolver, DispatchAdminResolver, MerchantAdminResolver, AfterSalesReviewAdminResolver, PaymentTimeoutAdminResolver, DeliveryStatsResolver, SalesStatsResolver, AddressChangeAdminResolver, SupportAdminResolver, CompensationAdminResolver, ChatAdminResolver, CampusAdAdminResolver, CampusLockerAdminResolver, TelemetryAdminResolver],
    },
    shopApiExtensions: {
        schema: () => {
            const { gql } = require('graphql-tag');
            // shop 与 admin 是两个独立 schema，输出类型需各自定义
            return gql`
                """结算页分区动态加价拆解（时段/供需/手动倍率）"""
                type CampusPricingBreakdownItem {
                    key: String!
                    label: String!
                    fee: Int!
                }

                type CampusZone {
                    id: ID!
                    name: String!
                    """分区基价（分）"""
                    fee: Int!
                    """实时应付（分，= 基价 + 动态加价，单笔封顶）"""
                    price: Int!
                    """动态加价金额（分）"""
                    addFee: Int!
                    breakdown: [CampusPricingBreakdownItem!]!
                    channelId: ID!
                }

                type CampusBuilding {
                    id: ID!
                    name: String!
                    detail: String
                    zoneId: ID!
                    channelId: ID!
                }

                type RiderProfile {
                    customerId: ID!
                    riderStatus: String
                    riderRealName: String
                    riderStudentNo: String
                    riderCampus: String
                    riderCredit: Int
                    """P2-5 合规明细（骑手端到期提醒）"""
                    compliance: RiderCompliance
                    riderHealthCertExpiry: DateTime
                    riderInsuranceExpiry: DateTime
                }

                """骑手合规判定项（P2-5）"""
                type RiderComplianceItem {
                    key: String!
                    label: String!
                    """ok / expiring / expired / pending / missing / failed"""
                    status: String!
                    expiry: DateTime
                    detail: String
                }

                type RiderCompliance {
                    ok: Boolean!
                    blocked: Boolean!
                    pending: Boolean!
                    items: [RiderComplianceItem!]!
                }

                type RiderApplyResult {
                    status: String!
                }

                type DeliverySlot {
                    id: ID!
                    slotDate: String!
                    startTime: String!
                    endTime: String!
                    zoneId: ID
                    capacity: Int!
                    lockedCount: Int!
                    active: Boolean!
                    channelId: ID!
                }

                type RiderEarning {
                    id: ID!
                    orderId: ID!
                    riderCustomerId: ID!
                    amount: Int!
                    tip: Int!
                    status: String!
                    createdAt: DateTime
                    channelId: ID!
                }

                type CampusRiderOnlineResult {
                    online: Boolean!
                }

                type CampusCapacityCheck {
                    paused: Boolean!
                    ridersOnline: Int!
                }

                type CampusRejectResult {
                    backToHall: Boolean!
                }

                input CampusErrandInput {
                    kind: String!
                    fromText: String!
                    toText: String!
                    tip: Int!
                    buildingId: ID
                    campusZone: String
                    errandFrom: String
                    note: String
                }

                type CampusErrandInfoResult {
                    orderId: ID!
                }

                type CampusErrandVariantResult {
                    variantId: ID!
                    sku: String!
                    errandBaseFee: Int!
                }

                type CampusArrivedResult {
                    leg1Status: String!
                }

                """信任文案（§113）：评价页信任签名卡三行，店铺级配置；text 为空=回落 C 端默认文案"""
                type CampusStoreTrust {
                    """质量行开关（false=该行不展示）"""
                    qualityEnabled: Boolean!
                    """质量行自定义文案（空=回落默认）"""
                    qualityText: String
                    """服务行开关"""
                    serviceEnabled: Boolean!
                    """服务行自定义文案（空=回落默认）"""
                    serviceText: String
                    """时间行开关"""
                    timeEnabled: Boolean!
                    """时间行自定义文案（空=回落默认）"""
                    timeText: String
                }

                type WaimaiStore {
                    channelId: ID!
                    name: String!
                    logo: String
                    tags: [String!]!
                    monthlySales: Int!
                    promoText: String
                    paused: Boolean!
                    routesEnabled: [String!]!
                    deliveryMinutes: Int
                    minOrderAmount: Int
                    deliveryFee: Int
                    storeAddress: String
                    storePhone: String
                    storeNotice: String
                    businessHours: String
                    """当前是否可下单（营业时段内、未暂停营业且今日不在休业日历，服务端按 UTC+8 判定）"""
                    openNow: Boolean!
                    """今日休业（§70 营业日历）：true 时 C 端展示「今日休业」并禁止下单"""
                    closedToday: Boolean!
                    """今日休业备注（如「国庆假期」），空=无备注或未休业"""
                    closureNote: String
                    errandBaseFee: Int
                    freeShippingThreshold: Int
                    """配送费阶梯（P3-4）JSON：[{minAmount:分, fee:分}]，null=不启用"""
                    deliveryFeeTiers: String
                    foodLicenseNo: String
                    foodLicenseImage: String
                    foodLicenseExpiry: String
                    foodSafetyGrade: String
                    foodSafetyCommitmentImage: String
                    kitchenLiveUrl: String
                    kitchenLiveEnabled: Boolean!
                    """打包费开关（C 端结算页预估用；最终金额以结算时落账为准）"""
                    packingFeeEnabled: Boolean!
                    """计费方式：perItem=按件累加 / perOrder=每单固定"""
                    packingFeeMode: String!
                    """打包费金额（分）：perItem=单件，perOrder=每单"""
                    packingFeeAmount: Int!
                    """单笔封顶（分，null=不封顶）"""
                    packingFeeCap: Int
                    """C 端展示名称（空=打包费）"""
                    packingFeeLabel: String
                }

                """单店进店凭证：C 端按 channelId 换取渠道 token（服务端限流，避免列表批量暴露）"""
                type CampusStoreEntry {
                    channelId: ID!
                    channelToken: String!
                }

                """隐私联系方式（号码保护）：protected=false 时 display 即真实号"""
                type CampusPrivacyContact {
                    protected: Boolean!
                    display: String
                    callable: String
                    provider: String!
                    expiresAt: DateTime
                    note: String
                }

                type CampusOrderRider {
                    realName: String!
                    credit: Int!
                    phone: String
                    location: CampusRiderLocation
                    destination: CampusRiderDestination
                    distanceMeters: Int
                    etaMinutes: Int
                    deliveryStatus: String
                }

                type CampusRiderLocation {
                    lat: Float!
                    lng: Float!
                }

                """配送目标楼栋（有坐标才返回）"""
                type CampusRiderDestination {
                    name: String!
                    detail: String
                    lat: Float!
                    lng: Float!
                }

                """C 端订单配送卡：承运方、外部快递单号与骑手、校园交接点"""
                type CampusOrderDelivery {
                    deliveryPlan: String
                    handoverMode: String
                    provider: String
                    thirdPartyNo: String
                    state: String
                    courierName: String
                    courierPhone: String
                    handoverPointName: String
                    handoverPointAddress: String
                    handoverAt: DateTime
                }

                extend type Order {
                    campusOrderDelivery: CampusOrderDelivery
                }

                type CampusR2Relay {
                    orderId: ID!
                    orderCode: String!
                    state: String!
                    hallStatus: String
                    deliveryStatus: String
                    errandTo: String
                    tip: Int!
                    totalWithTax: Int!
                }

                type RiderWallet {
                    available: Int!
                    frozen: Int!
                    totalEarned: Int!
                }

                type RiderWithdrawalRequest {
                    id: ID!
                    customerId: ID!
                    channelId: ID!
                    amount: Int!
                    channel: String!
                    account: String!
                    status: String!
                    remark: String
                    reviewedBy: String
                    reviewedAt: DateTime
                    payoutRef: String
                    payoutProof: String
                    failReason: String
                    createdAt: DateTime
                }

                type RiderBalanceTx {
                    id: ID!
                    createdAt: DateTime
                    type: String!
                    amount: Int!
                    balanceAfter: Int!
                    remark: String
                }

                type CampusHallOrderCustomFields {
                    hallStatus: String
                    hallEnteredAt: DateTime
                    tip: Int
                    fulfillmentRoute: String
                    campusZone: String
                    buildingId: String
                    deliverySlotText: String
                    routeGroupId: String
                }

                type CampusHallOrder {
                    id: ID!
                    code: String!
                    total: Int!
                    shipping: Int!
                    createdAt: DateTime!
                    channelId: ID!
                    channelName: String!
                    customFields: CampusHallOrderCustomFields
                }

                """批量接单逐单结果（P3-3）：单条失败不影响其余，message 为后端原文"""
                type CampusGrabResult {
                    orderId: ID!
                    ok: Boolean!
                    message: String
                }

                type CampusFavoriteVariant {
                    variantId: ID!
                    channelId: ID!
                }

                type CampusMySupportTicket {
                    id: ID!
                    orderCode: String
                    orderId: ID
                    """关联售后单主键（无关联为 null）"""
                    afterSalesRequestId: ID
                    """关联售后单当前状态，用于工单列表直接展示售后进度"""
                    afterSalesState: String
                    category: String!
                    content: String!
                    images: [String!]
                    status: String!
                    reply: String
                    repliedAt: DateTime
                    createdAt: DateTime!
                }

                type CampusMyRiderAppeal {
                    id: ID!
                    orderCode: String
                    reason: String!
                    images: [String!]
                    status: String!
                    creditDelta: Int
                    reviewNote: String
                    reviewedAt: DateTime
                    createdAt: DateTime!
                }

                """在线客服会话（C 端）：未读数为顾客侧口径"""
                type CampusMyChatConversation {
                    id: ID!
                    orderCode: String
                    subject: String
                    status: String!
                    lastMessage: String
                    lastMessageAt: DateTime
                    lastSenderType: String
                    unreadForCustomer: Int!
                    createdAt: DateTime!
                }

                type CampusMyChatMessage {
                    id: ID!
                    conversationId: ID!
                    senderType: String!
                    content: String
                    images: [String!]
                    readAt: DateTime
                    createdAt: DateTime!
                }

                type CampusRiderRating {
                    riderCustomerId: ID!
                    avgRating: Float!
                    ratingCount: Int!
                }

                type CampusMyRiderReviewRow {
                    id: ID!
                    orderId: ID!
                    rating: Int!
                    tags: [String!]
                    comment: String
                    createdAt: DateTime!
                }

                type CampusRateRiderResult {
                    ok: Boolean!
                    rating: Int!
                }

                type CampusRiderShiftRow {
                    id: ID!
                    shiftDate: String!
                    startTime: String!
                    endTime: String!
                    note: String
                }

                """骑手配送导航坐标（gcj02，供 uni.openLocation）"""
                type CampusRiderNav {
                    orderId: ID!
                    orderCode: String!
                    storeName: String
                    storeAddress: String
                    storePhone: String
                    storeLat: Float
                    storeLng: Float
                    buildingName: String
                    buildingDetail: String
                    buildingLat: Float
                    buildingLng: Float
                    campusZone: String
                    note: String
                    deliveryStatus: String
                }

                """C 端在投广告（P2-3）：仅返回当前渠道、指定广告位、投放窗口内的广告"""
                type CampusActiveAd {
                    id: ID!
                    slot: String!
                    title: String!
                    imageUrl: String
                    linkUrl: String
                    endDate: String!
                }

                """语音/拍照搜索识别结果（P2-2）：keywords 可直接作为站内搜索词"""
                type CampusSearchAssistResult {
                    ok: Boolean!
                    """识别类型：voice / image"""
                    type: String!
                    provider: String!
                    """识别出的整句文本（仅用于回显，可能为空）"""
                    text: String!
                    keywords: [String!]!
                    latencyMs: Int!
                    error: String
                }

                """C 端商品当日额度（§68）：myToday/myRemaining 未登录时为 null"""
                type CampusProductDailyStock {
                    productId: ID!
                    dailyLimit: Int
                    perUserLimit: Int
                    soldToday: Int!
                    remaining: Int
                    myToday: Int
                    myRemaining: Int
                }

                extend type Query {
                    myRiderProfile: RiderProfile!
                    campusZones: [CampusZone!]!
                    campusBuildings(zoneId: ID): [CampusBuilding!]!
                    campusHall: [Order!]!
                    campusHallAll: [CampusHallOrder!]!
                    campusMyTasks(status: String): [Order!]!
                    campusShopSlots: [DeliverySlot!]!
                    myRiderEarnings(skip: Int, take: Int): [RiderEarning!]!
                    campusCapacityCheck: CampusCapacityCheck!
                    waimaiStoreList: [WaimaiStore!]!
                    """C 端进店换取单店渠道 token（按 channelId，避免 public 列表批量暴露 token）"""
                    campusStoreEntry(channelId: ID!): CampusStoreEntry!
                    """当前渠道信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案"""
                    campusStoreTrust: CampusStoreTrust!
                    """菜品每日限量/每人限购（§68）：当前渠道有限量配置商品的当日额度"""
                    campusProductDailyStock: [CampusProductDailyStock!]!
                    campusOrderRider(orderId: ID!): CampusOrderRider
                    """骑手侧顾客联系方式（号码保护）：仅本单骑手可查"""
                    campusRiderCustomerContact(orderId: ID!): CampusPrivacyContact!
                    """骑手交接码（R1/R2 第二段起送必填）：仅本单骑手、已抢单/配送中可读"""
                    campusTaskHandoverCode(orderId: ID!): String
                    campusR2Relay(orderId: ID!): CampusR2Relay
                    campusErrandVariant: CampusErrandVariantResult!
                    myRiderWallet: RiderWallet!
                    riderBalanceHistory(skip: Int, take: Int): [RiderBalanceTx!]!
                    riderWithdrawRequests(skip: Int, take: Int): [RiderWithdrawalRequest!]!
                    campusFavoriteStores: [String!]!
                    campusFavoriteVariants: [CampusFavoriteVariant!]!
                    """本单最近一次改址的差额状态（待补/待退/已结清）"""
                    campusMyAddressChange(orderId: ID!): CampusMyAddressChange
                    campusMySupportTickets(skip: Int, take: Int): [CampusMySupportTicket!]!
                    campusMyChatConversations(skip: Int, take: Int): [CampusMyChatConversation!]!
                    campusChatMessages(conversationId: ID!, afterId: ID, take: Int): [CampusMyChatMessage!]!
                    campusMyRiderAppeals(skip: Int, take: Int): [CampusMyRiderAppeal!]!
                    campusMyRiderRating: CampusRiderRating!
                    campusMyRiderReviews(skip: Int, take: Int): [CampusMyRiderReviewRow!]!
                    """本人云端口味偏好 JSON（未登录返回空串）"""
                    campusMyTasteProfile: String
                    campusMyShifts(from: String, to: String): [CampusRiderShiftRow!]!
                    campusRiderNav(orderId: ID!): CampusRiderNav
                    """语音/拍照搜索识别：type=voice/image，按渠道配置的服务商（内置 mock）"""
                    campusSearchAssist(type: String!, payload: String): CampusSearchAssistResult!
                    """C 端公开：按广告位取当前在投广告（最多 3 条，按投放金额降序）"""
                    campusActiveAds(slot: String!): [CampusActiveAd!]!
                    """C 端公开：本渠道启用的智能取餐柜站点（P2-4）"""
                    campusLockerStations: [CampusLockerStation!]!
                    """C 端公开：无人配送是否开通（P2-4 接口占位）"""
                    campusUnmannedDeliveryChannel: CampusUnmannedDeliveryChannelInfo!
                }

                """C 端取餐柜站点：仅启用站点，按 sort / 创建时间"""
                type CampusLockerStation {
                    id: ID!
                    name: String!
                    location: String!
                    provider: String!
                    providerName: String!
                    totalCells: Int!
                    availableCells: Int!
                    openHours: String
                    pickupGuide: String
                }

                type CampusUnmannedDeliveryChannelInfo {
                    enabled: Boolean!
                    provider: String!
                    providerName: String!
                }

                type CampusMyAddressChange {
                    id: ID!
                    diff: Int!
                    status: String!
                    settleAction: String
                    fromZone: String!
                    fromBuilding: String!
                    toZone: String!
                    toBuilding: String!
                    createdAt: DateTime!
                }

                type CampusAddressChangeResult {
                    diff: Int!
                    oldFee: Int!
                    newFee: Int!
                    fromZone: String!
                    toZone: String!
                    recordId: ID!
                }

                extend type Mutation {
                    applyRider(realName: String!, studentNo: String!, campus: String!, idImg: String, healthCertImg: String): RiderApplyResult!
                    campusGrabOrder(orderId: ID!): Order!
                    """批量接单（P3-3）：逐单独立事务，返回每条结果；单渠道一次最多 10 单"""
                    campusGrabOrders(orderIds: [ID!]!): [CampusGrabResult!]!
                    campusStartTask(orderId: ID!, code: String): Order!
                    campusTransferTask(orderId: ID!, photos: [String!]!, note: String): Order!
                    campusDeliverTask(orderId: ID!, photos: [String!]!, note: String): Order!
                    """R5 顾客侧重发交接码（仅本人待交接订单，10 分钟限流）"""
                    campusResendHandoverCode(orderId: ID!): String!
                    campusRiderReportLocation(orderId: ID!, lat: Float!, lng: Float!): Order!
                    campusUrgeOrder(orderId: ID!): Order!
                    campusReportException(orderId: ID!, type: String!, photos: [String!]!, note: String): Order!
                    campusSetDeliveryTarget(zoneId: ID!, buildingId: ID!, route: String, slotId: Int): Order!
                    campusChangeDeliveryAddress(orderId: ID!, zoneId: ID!, buildingId: ID!, detail: String): CampusAddressChangeResult!
                    applyOrderInvoice(orderId: ID!, invoiceInfo: String!): Boolean!
                    """保存本人云端口味偏好（空串=清除）"""
                    campusUpdateTasteProfile(input: String!): String!
                    campusRejectAssignment(orderId: ID!): CampusRejectResult!
                    campusRiderOnline(online: Boolean!): CampusRiderOnlineResult!
                    campusRiderHeartbeat: CampusRiderOnlineResult!
                    campusSetErrandInfo(input: CampusErrandInput!): CampusErrandInfoResult!
                    campusMarkArrived(orderId: ID!): CampusArrivedResult!
                    riderWithdraw(amount: Int!, channel: String!, account: String!): RiderWithdrawalRequest!
                    campusToggleFavoriteStore(channelId: ID!): [String!]!
                    campusToggleFavoriteVariant(variantId: ID!, channelId: ID!): [CampusFavoriteVariant!]!
                    campusCreateSupportTicket(category: String!, content: String!, images: [String!], orderCode: String): CampusMySupportTicket!
                    campusStartChat(orderCode: String, subject: String): CampusMyChatConversation!
                    campusSendChatMessage(conversationId: ID!, content: String, images: [String!]): CampusMyChatMessage!
                    campusMarkChatRead(conversationId: ID!): CampusMyChatConversation!
                    campusCloseChat(conversationId: ID!): CampusMyChatConversation!
                    campusCreateRiderAppeal(reason: String!, orderId: ID, images: [String!]): CampusMyRiderAppeal!
                    campusRateRider(orderId: ID!, rating: Int!, tags: [String!], comment: String): CampusRateRiderResult!
                    """退款后满意度回访（§93）：仅本人已退款完成的售后单，1-5 分"""
                    campusSubmitAfterSalesReview(requestId: ID!, score: Int!, comment: String, tags: [String!]): CampusAfterSalesReviewResult!
                    """P4-4 批量埋点上报（匿名可用），返回入库条数"""
                    campusTrackEvents(input: CampusTrackEventBatchInput!): Int!
                    """P4-4 前端错误上报（匿名可用）"""
                    campusReportError(input: CampusErrorReportInput!): Boolean!
                    """待付款订单续付：校验归属后把该订单设为活跃订单，前端随后调用 addPaymentToOrder"""
                    campusResumePaymentOrder(orderId: ID!): Order!
                }

                type CampusAfterSalesReviewResult {
                    ok: Boolean!
                    score: Int!
                }

                input CampusTrackEventInput {
                    eventName: String!
                    page: String
                    sessionId: String
                    """JSON 字符串或对象"""
                    props: String
                    createdAt: String
                }

                input CampusTrackEventBatchInput {
                    events: [CampusTrackEventInput!]!
                }

                input CampusErrorReportInput {
                    """c-end / admin，缺省 c-end"""
                    source: String
                    """error / warn，缺省 error"""
                    level: String
                    message: String!
                    stack: String
                    page: String
                    url: String
                }
            `;
        },
        resolvers: [OrderDeliveryShopResolver, RiderShopResolver, HallShopResolver, RiderTaskShopResolver, ErrandShopResolver, WaimaiShopResolver, R2ShopResolver, InvoiceShopResolver, FavoriteShopResolver, AddressChangeShopResolver, SupportShopResolver, ChatShopResolver, CampusAdShopResolver, CampusLockerShopResolver, TasteProfileShopResolver, TelemetryShopResolver, ResumePaymentShopResolver, AfterSalesReviewShopResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            ...campusPermissionDefinitions,
        ];
        config.customFields = {
            ...config.customFields,
            Order: [...(config.customFields.Order ?? []), ...(campusCustomFields.Order ?? [])],
            OrderLine: [...(config.customFields.OrderLine ?? []), ...(campusCustomFields.OrderLine ?? [])],
            Customer: [...(config.customFields.Customer ?? []), ...(campusCustomFields.Customer ?? [])],
            Channel: [...(config.customFields.Channel ?? []), ...(campusCustomFields.Channel ?? [])],
            Product: [...(config.customFields.Product ?? []), ...(campusCustomFields.Product ?? [])],
            Address: [...(config.customFields.Address ?? []), ...(campusCustomFields.Address ?? [])],
        };
        config.shippingOptions.shippingCalculators = [
            ...(config.shippingOptions.shippingCalculators ?? []),
            campusErrandCalculator,
        ];
        // 起送价硬校验（二期 §3.2）：ArrangingPayment 过渡拦截，跑腿单豁免
        // 取消守卫：C 端在骑手已接单/配送中/已送达时不可自助取消（后台强制路径不受限）
        config.orderOptions = {
            ...(config.orderOptions ?? {}),
            process: [...(config.orderOptions?.process ?? []), campusPackingFeeProcess, campusAddonFeeProcess, campusMinOrderProcess, campusOrderGateProcess, campusCancelGuardProcess],
        } as any;
        // 跑腿单 ShippingLine 分配：包装既有策略（cjk Box 按配送档案分箱，跑腿 0 元载体无档案
        // 绑定会被返回空数组 → 孤儿线）。本插件在 dev-config 中位于 CjkPlugin 之后，
        // configuration 钩子后执行，此处拿到的即为 cjk 已设置的策略，包装后原行为不变。
        const prevAssignmentStrategy = config.shippingOptions.shippingLineAssignmentStrategy;
        if (prevAssignmentStrategy) {
            config.shippingOptions.shippingLineAssignmentStrategy =
                new CampusErrandShippingLineAssignmentStrategy(prevAssignmentStrategy);
        }
        // 待付款补偿任务：不再注册 ScheduledTask（生产无 worker 不执行），改由 PaymentTimeoutJob 自管定时器
        return config;
    },
    compatibility: '^3.6.4',
})
export class CampusDeliveryPlugin implements OnApplicationBootstrap {
    constructor(
        private eventBus: EventBus,
        private hallService: HallService,
        private r4TagService: R4TagService,
        private moduleRef: ModuleRef,
        private notify: CampusNotifyService,
        private paymentTimeout: PaymentTimeoutJob,
        private configService: CampusConfigService,
        private slotLock: SlotLockService,
        private connection: TransactionalConnection,
    ) {}

    /** vendure Injector 需由 ModuleRef 构造（插件模块类构造器不直接提供 Injector） */
    private get injector(): Injector {
        return new Injector(this.moduleRef);
    }

    onApplicationBootstrap(): void {
        bindCampusErrandCalculatorConnection(this.injector.get(TransactionalConnection));
        bindMinOrderConnection(this.injector.get(TransactionalConnection));
        bindPackingFeeDeps(this.injector.get(TransactionalConnection), this.injector.get(OrderService));
        bindAddonFeeDeps(this.injector.get(TransactionalConnection), this.injector.get(OrderService));
        bindOrderGateConnection(this.injector.get(TransactionalConnection));
        // 权限迁移（B 组漏项）：写操作拆出 CampusDispatch，给已持有看板权限的角色补授，防现有运营失权
        void this.grantDispatchPermission().catch(e =>
            Logger.error(`grant CampusDispatch failed: ${String(e)}`, 'CampusDispatch'),
        );
        // 待付款补偿任务：自管定时器（生产无 worker，ScheduledTask 不执行）
        const paymentTimeoutJob = this.injector.get(PaymentTimeoutJob);
        paymentTimeoutJob
            .init()
            .then(() => paymentTimeoutJob.startCompensationLoop())
            .catch(e => Logger.error(`PaymentTimeout init failed: ${String(e)}`, 'PaymentTimeout'));
        // 沽清次日自动恢复（§66）：自管定时器，每日 04:00 把「全店沽清」批次恢复在售
        this.injector.get(SoldOutAutoRestoreJob).start();
        // 售后 SLA 主动提醒（§90）：10 分钟扫描临期/超时待处理单，向商家发站内信
        this.injector.get(AfterSalesSlaAlertJob).start();
        // 商家自动接单（§69）：15s 扫描待接单订单，营业中且未休息时按延迟秒数自动确认
        this.injector.get(AutoAcceptJob).start();
        // 每日日报推送（§86）：30 分钟扫描到点渠道，把昨日日报推到店铺群（同一天只推一条）
        this.injector.get(DailyReportPushJob).start();
        // 回访到期提醒（§95）：10 分钟扫描到期回访，向商家发站内信（同一条只提醒一次）
        this.injector.get(AfterSalesFollowUpRemindJob).start();
        // 骑手合规到期提醒（§54.6）：60 分钟扫描 30 天内到期/已过期的健康证与保险，向骑手发站内信（每人每天一条）
        this.injector.get(RiderComplianceReminderJob).start();
        // 售后月度摘要推送（§95）：每月指定日把上月售后汇总推到店铺群（同月只推一条）
        this.injector.get(AfterSalesMonthlyPushJob).start();
        // 售后自动分配（§96）：5 分钟把未指派售后单派给未完结量最少的处理人
        this.injector.get(AfterSalesAutoAssignJob).start();
        this.injector.get(AfterSalesAutoRuleJob).start();
        // 售后 SLA 营业时间感知重算（§99）：5 分钟按渠道营业时段刷新 slaDeadlineAt
        this.injector.get(AfterSalesSlaDeadlineJob).start();
        // 售后异常预警推送（§96）：30 分钟检查近 7 日退款率/超时待处理，超阈值推店铺群
        this.injector.get(AfterSalesAnomalyAlertJob).start();
        this.eventBus.ofType(OrderPlacedEvent).subscribe(({ ctx, order }) => {
            // 下单成功通知（waimai 流程下单即支付完成；进大厅逻辑同源）
            void this.h5BaseUrl(ctx).then(url => this.notify.user(ctx, order.id, 'orderPlaced', undefined, url));
        });
        // 支付闸门（A 组漏项）：进入 ArrangingPayment≠已支付，只有 Payment Authorized/Settled 才入厅，
        // 未支付订单不进大厅、不可被抢（15min 待付款窗口内的单不再占用运力）。
        this.eventBus.ofType(PaymentStateTransitionEvent).subscribe(({ ctx, toState, order }) => {
            if (toState !== 'Authorized' && toState !== 'Settled') return;
            this.hallService.onOrderPlaced(ctx, order).catch(e => Logger.error(String(e), 'CampusHall'));
        });
        // R4 到店自取打标（二期 §5.4）：store-pickup 运费方式订单在支付闸门补写 fulfillmentRoute；
        // 取消脱厅（3.3）：订单取消终态时清 hallStatus/指派字段，退出大厅与整组抢单链路；
        // 待付款任务：离开 ArrangingPayment 作废，进入 ArrangingPayment 登记
        this.eventBus.ofType(OrderStateTransitionEvent).subscribe(e => {
            this.r4TagService.tagR4(e).catch(err => Logger.error(`R4 tag failed: ${String(err)}`, 'CampusR4Tag'));
            if (e.toState === 'Cancelled') {
                // P3-2 取消归因：C 端顾客主动取消标记 customer（自动拉黑规则只统计该口径），
                // 其余为系统/运营取消（campusCause 已有归因标记的视为 system）
                void this.injector.get(OrderService).updateCustomFields(
                    e.ctx,
                    e.order.id,
                    { campusCancelCause: e.ctx.apiType === 'shop' ? 'customer' : ((e.order.customFields as any)?.campusCause ? 'system' : 'ops') } as any,
                ).catch(err => Logger.warn(`Cancel cause tag failed: ${String(err)}`, 'CampusSupport'));
                // 已推给达达/美团的运单必须同步取消：按「取消外部运单 → 脱厅 → 释放时段」顺序串行，
                // 不能三者并行——并行时外部取消失败也已脱厅，外部骑手仍可能上门取餐造成餐损。
                // 整段异步执行，不阻塞事件总线；任一步失败只记日志，后续步骤照常执行。
                void (async () => {
                    await this.injector
                        .get(ThirdPartyDeliveryService)
                        .cancel(e.ctx, Number(e.order.id), 'order cancelled')
                        .catch(err => Logger.warn(`Cancel external delivery failed: ${String(err)}`, 'CampusHall'));
                    await this.hallService.exitHall(e.ctx, e.order)
                        .catch(err => Logger.error(`Hall exit failed: ${String(err)}`, 'CampusHall'));
                    await this.slotLock.unlock(e.ctx, Number(e.order.id))
                        .catch(err => Logger.warn(`Slot unlock failed: ${String(err)}`, 'CampusSlot'));
                })();
                // 用户本人主动取消不推（ctx.activeUserId 存在即本人操作）；商家/系统/超时取消才推
                if (!e.ctx.activeUserId) {
                    void this.h5BaseUrl(e.ctx).then(url => this.notify.user(e.ctx, e.order.id, 'orderCancelled', undefined, url));
                }
            }
            if (e.fromState === 'ArrangingPayment' && e.toState !== 'ArrangingPayment') {
                void this.paymentTimeout.cancelForOrder(Number(e.order.id)).catch(err => Logger.warn(String(err), 'PaymentTimeout'));
            }
            if (e.toState === 'ArrangingPayment') {
                void this.paymentTimeout
                    .scheduleForOrder(e.ctx, Number(e.order.id), Number(e.ctx.channelId), e.toState)
                    .catch(err => Logger.warn(`schedule payment timeout failed: ${String(err)}`, 'PaymentTimeout'));
            }
        });
        // 售后进度（§97）：覆盖顾客关心的全部节点，其余状态不推
        this.eventBus.ofType(AfterSalesStateTransitionEvent).subscribe(e => {
            const text = e.toState === 'Approved' ? '售后审核通过'
                : e.toState === 'Rejected' ? '售后申请被拒绝'
                : e.toState === 'Received' ? '商家已收到退货'
                : e.toState === 'Refunded' ? '退款已到账，欢迎评价本次售后处理'
                : e.toState === 'RefundFailed' ? '退款失败，请联系客服'
                : e.toState === 'ExchangeShipped' ? '换货已发出，请留意物流'
                : e.toState === 'Closed' ? '售后已结束'
                : null;
            if (!text) return;
            // dedupe 用「来源状态→目标状态」：同一售后单各进度各推一条，且 Closed 的两种来源不互相吞掉
            void this.h5BaseUrl(e.ctx).then(url =>
                this.notify.user(e.ctx, e.orderId, 'afterSales', text, url, `${e.fromState ?? ''}->${e.toState}`),
            );
        });
        // 工单与售后打通：退款到账自动关闭关联工单（运营不再重复跟单）
        this.eventBus.ofType(AfterSalesStateTransitionEvent).subscribe(e => {
            void this.injector
                .get(SupportService)
                .onAfterSalesStateChange(e.ctx, Number(e.requestId), e.toState)
                .catch(err => Logger.warn(`售后联动关单失败: ${String(err)}`, 'CampusSupport'));
        });
        this.injector.get(DispatchJobService).start();
        // 运力预警：在线会话收口 + 待抢单量/在线骑手数告警（自管定时器，生产无 worker）
        this.injector.get(CapacityAlertJob).start();
        // P3-2 黑名单自动规则：每日扫顾客主动取消次数达标者（阈值 0 = 关闭）
        this.injector.get(BlacklistAutoScanJob).start();
        // R1 提现意图对账：进程在「落库→扣款→确认」之间中断时，按流水 remark 自动收敛
        this.injector.get(WithdrawReconcileJob).start();
        // R2 补偿任务：券/站内信失败落库后退避重试（耗尽才告警）
        this.injector.get(CompensationRetryJob).start();
        // R8 遗留巡检：每日把静默卡住的残留量汇总到平台群（只读 COUNT）
        this.injector.get(OpsCheckJob).start();
        // R3 锁位对账：容量与实际占位偏差告警（只读，先观测不自动修复）
        this.injector.get(SlotReconcileJob).start();
        // 埋点/错误报告过期清理：保留 90 天，分批删除避免影响上报写入
        this.injector.get(TelemetryRetentionJob).start();
        // 管理消息推送：notification 发布 AdminNotifyEvent（新订单/售后），本插件订阅后转飞书群
        this.eventBus.ofType(AdminNotifyEvent).subscribe(event => {
            void this.injector.get(FeishuNotifyService).onAdminNotify(event);
        });
        // 每日经营汇总（UTC+8 定点，advisory lock + 群消息回读防重，零建表）
        this.injector.get(FeishuDigestService).start();
    }

    /** 权限迁移：permissions 为 simple-array（逗号分隔），给持有 CampusViewDispatch 的角色补授 CampusDispatch。
     * 幂等；启动时执行，早于任何请求，不涉及权限缓存失效问题。 */
    private async grantDispatchPermission(): Promise<void> {
        const raw = this.connection.rawConnection;
        const rows: Array<{ id: number; permissions: string }> = await raw.query(
            `SELECT id, permissions FROM role WHERE permissions LIKE '%CampusViewDispatch%'`,
        );
        let granted = 0;
        for (const row of rows) {
            const perms = String(row.permissions ?? '')
                .split(',')
                .map(p => p.trim())
                .filter(Boolean);
            if (perms.includes(CampusPermissions.CampusDispatch)) continue;
            perms.push(CampusPermissions.CampusDispatch);
            await raw.query(`UPDATE role SET permissions = $1 WHERE id = $2`, [perms.join(','), row.id]);
            granted += 1;
        }
        if (granted) Logger.info(`CampusDispatch granted to ${granted} role(s)`, 'CampusDispatch');
    }

    /** h5BaseUrl 取渠道配置（未配置返回 undefined，通知静默不带 url） */
    private async h5BaseUrl(ctx: RequestContext): Promise<string | undefined> {
        try {
            const cfg = await this.configService.getConfig(ctx);
            return (cfg as any)?.h5BaseUrl ?? undefined;
        } catch {
            return undefined;
        }
    }
}
