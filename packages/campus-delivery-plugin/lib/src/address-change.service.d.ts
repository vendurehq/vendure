import { ModuleRef } from '@nestjs/core';
import { CustomerService, ID, OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusAddressChange } from './campus-address-change.entity';
import { CampusBuilding } from './campus-building.entity';
import { CapacityService } from './capacity.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { HallService } from './hall.service';
import { CampusNotifyService } from './campus-notify.service';
import { ThirdPartyDeliveryService } from './third-party-delivery.service';
export declare class AddressChangeService {
    private connection;
    private orderService;
    private customerService;
    private capacity;
    private notify;
    private thirdParty;
    private moduleRef;
    private hall;
    private feishu;
    constructor(connection: TransactionalConnection, orderService: OrderService, customerService: CustomerService, capacity: CapacityService, notify: CampusNotifyService, thirdParty: ThirdPartyDeliveryService, moduleRef: ModuleRef, hall: HallService, feishu: FeishuNotifyService);
    /** 顾客自助改址（取货前、可跨分区）。差额不阻塞改址，写入台账待运营结算。 */
    changeByCustomer(ctx: RequestContext, input: {
        orderId: ID;
        zoneId: ID;
        buildingId: ID;
        detail?: string;
    }): Promise<{
        diff: number;
        oldFee: number;
        newFee: number;
        fromZone: string;
        toZone: string;
        recordId: ID;
    }>;
    /**
     * 运营代客改址：C 端取货后锁死，运营可代改（必须填原因，全程留痕）。
     * 仅「已取消 / 已送达」拒绝；骑手取货、外部已接单均允许代改。
     */
    adminChange(ctx: RequestContext, input: {
        orderId: ID;
        zoneId: ID;
        buildingId: ID;
        detail?: string;
        reason: string;
    }): Promise<{
        diff: number;
        oldFee: number;
        newFee: number;
        fromZone: string;
        toZone: string;
        recordId: ID;
    }>;
    /** 改址差额试算（运营端预览：不写台账、不改订单） */
    quote(ctx: RequestContext, orderId: ID, zoneId: ID): Promise<{
        oldFee: number;
        newFee: number;
        diff: number;
        zoneId: any;
        zoneName: string;
        buildings: CampusBuilding[];
    }>;
    /** 顾客端：本单最近一次改址（差额状态感知，含已结清） */
    myLatest(ctx: RequestContext, orderId: ID): Promise<{
        id: ID;
        diff: number;
        status: string;
        settleAction: string | null;
        fromZone: string;
        fromBuilding: string;
        toZone: string;
        toBuilding: string;
        createdAt: Date;
    } | null>;
    /** 动态计价预览：当前供需 + 各分区试算拆解（后台配置页用） */
    dynamicPreview(ctx: RequestContext): Promise<{
        at: string;
        enabled: boolean;
        backlog: number;
        onlineRiders: number;
        manualMultiplier: number;
        maxAddFee: number;
        errand: {
            key: "errand" | "third-party";
            configured: boolean;
            baseFee: number;
            price: number;
            addFee: number;
            breakdown: import("./dynamic-pricing").PricingBreakdownItem[];
        } | null;
        thirdParty: {
            key: "errand" | "third-party";
            configured: boolean;
            baseFee: number;
            price: number;
            addFee: number;
            breakdown: import("./dynamic-pricing").PricingBreakdownItem[];
        } | null;
        supply: {
            backlogThreshold: number;
            riderThreshold: number | null;
            addFee: number;
        } | null;
        peakWindows: import("./dynamic-pricing").PeakWindow[];
        zones: {
            zoneId: any;
            zoneName: string;
            baseFee: number;
            price: number;
            addFee: number;
            breakdown: import("./dynamic-pricing").PricingBreakdownItem[];
        }[];
    }>;
    list(ctx: RequestContext, opts?: {
        status?: string;
        orderId?: ID;
        skip?: number;
        take?: number;
    }): Promise<CampusAddressChange[]>;
    stats(ctx: RequestContext): Promise<{
        total: number;
        pendingCount: number;
        pendingCollect: number;
        pendingRefund: number;
    }>;
    /** 运营结清：refund=真实退款 / collect=补收（必须填凭证）/ waive=免收 / pending=撤销结清 */
    settle(ctx: RequestContext, id: ID, action: string, note?: string): Promise<CampusAddressChange | null>;
    /** 部分退款（fork 无 core RefundService，走 OrderService.refundOrder/settleRefund，与 dispatch-admin 同源）。
     * refund 表 shipping/adjustment 列 NOT NULL 必须显式传 0；超额退款抛错。 */
    private refundAmount;
    /**
     * H4：自助改址前的未结清补差闸门。
     * 只统计「其它订单」的待补收差额（本单连续改址允许，顾客改错后仍可纠正），
     * 累计金额或笔数超限时要求先结清，防止反复改到高价分区后一直欠费。
     */
    private assertNoUnpaidDiff;
    private loadOrder;
    private assertNotCancelledOrDelivered;
    private resolveTarget;
    private applyChange;
    /** 生效运费：最近一次改址落库的 newFee；无改址史回退下单快照 shippingWithTax */
    private effectiveOldFee;
    /** R1 商户自配送改址：推管理群（商户履约方），避免商户仍按旧楼栋配送 */
    private notifyMerchantAddressChanged;
    /** 改址定向提醒在途骑手（best-effort，失败不阻塞改址）：复用渠道 orderShippedTemplateId。 */
    private notifyRiderAddressChanged;
    private channelIdOf;
}
