import { ModuleRef } from '@nestjs/core';
import { CustomerService, ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusRiderAppeal, CampusBlacklist, CampusSupportTicket } from './support.entities';
import { RiderCreditService } from './rider-credit.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { PrivacyNumberService } from './privacy-number.service';
export declare const TICKET_CATEGORIES: string[];
export declare const TICKET_STATUSES: string[];
/** 工单来源：顾客提交 / 外部运单异常自动建单 */
export declare const TICKET_SOURCES: string[];
export declare const APPEAL_STATUSES: string[];
/**
 * 客服工单 + 骑手申诉 + 下单黑名单（站内留言制，非实时 IM）。
 * C 端（shop-api）只操作自己的记录；后台（admin-api）按当前渠道隔离处理。
 */
export declare class SupportService {
    private connection;
    private customerService;
    private credit;
    private feishu;
    private moduleRef?;
    /** 号码保护（H2）：可选注入；缺失时（单测/独立装配）退回原文，不影响工单主流程 */
    private privacy?;
    /** 售后插件为可选依赖：未安装时工单仍可用，仅“工单↔售后”联动降级 */
    private afterSalesSvc?;
    constructor(connection: TransactionalConnection, customerService: CustomerService, credit: RiderCreditService, feishu: FeishuNotifyService, moduleRef?: ModuleRef | undefined, 
    /** 号码保护（H2）：可选注入；缺失时（单测/独立装配）退回原文，不影响工单主流程 */
    privacy?: PrivacyNumberService | undefined);
    /** 展示号转换器：启用号码保护时脱敏，未启用/依赖缺失时退回原文 */
    private phoneDisplayer;
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private getAfterSales;
    private requireCustomer;
    /** 飞书提醒：仅记录日志、绝不阻塞主流程（未启用时 pushEvent 直接返回 true） */
    private pushFeishu;
    /**
     * 站内信：复用 message-plugin 的 Message/MessageDelivery（invoice-plugin / coupon-plugin 已落地范式）；
     * 未装 message-plugin 时实体不存在，静默跳过，绝不阻塞工单/申诉主流程。
     */
    private sendInAppMessage;
    /**
     * 工单→售后打通：按订单号解析订单（校验归属与本店渠道）并挂接该订单在途售后单。
     * 订单号解析不到时保持宽松（工单仍可提交，仅不关联），避免顾客写错一位订单号就投诉无门；
     * 但订单存在且不属于本人时明确拒绝，防止工单被挂到他人订单上造成误处理。
     */
    private resolveOrderLink;
    /** 该订单最新一条未关闭售后单（未装售后插件/实体未注册时返回 null，绝不阻断工单） */
    private findActiveAfterSalesId;
    /** 批量取售后单摘要（工单列表回显用）：按工单已关联 id ∪ 订单号反查，返回 [售后单 id, 订单 id] 两级索引 */
    private loadAfterSalesSummaries;
    private static afterSalesView;
    createTicket(ctx: RequestContext, input: {
        category: string;
        content: string;
        images?: string[] | null;
        orderCode?: string | null;
    }): Promise<any>;
    /**
     * R7 系统工单（外部运单异常等）：不依赖顾客登录态，幂等键保证同一异常只建一张。
     * 返回已存在/新建的工单 id，调用方据此在告警文案中带上工单号。
     */
    createSystemTicket(ctx: RequestContext, input: {
        /** 工单幂等键（source + 单号 + 外部运单号），重复调用不会再建单 */
        dedupeKey: string;
        orderCode: string;
        orderId: number | null;
        category: string;
        source: string;
        content: string;
        channelId?: ID;
    }): Promise<{
        id: number | null;
        created: boolean;
    }>;
    /** 当前值班人（§100 值班排班；表不存在/查询失败按无人值班处理，不阻断建单） */
    private resolveDutyAssignee;
    myTickets(ctx: RequestContext, skip?: number, take?: number): Promise<CampusSupportTicket[] | ({
        afterSalesRequestId: number | null;
        afterSalesState: null;
        afterSalesType: null;
        afterSalesRefundAmount: null;
        afterSalesActualRefundAmount: null;
        channelId: ID;
        customerId: number | null;
        orderCode: string | null;
        orderId: number | null;
        source: string;
        dedupeKey: string | null;
        assigneeId: number | null;
        category: string;
        content: string;
        images: string[] | null;
        status: string;
        reply: string | null;
        repliedBy: string | null;
        repliedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    } | {
        afterSalesRequestId: number | null;
        afterSalesState: any;
        afterSalesType: any;
        afterSalesRefundAmount: number | null;
        afterSalesActualRefundAmount: number | null;
        channelId: ID;
        customerId: number | null;
        orderCode: string | null;
        orderId: number | null;
        source: string;
        dedupeKey: string | null;
        assigneeId: number | null;
        category: string;
        content: string;
        images: string[] | null;
        status: string;
        reply: string | null;
        repliedBy: string | null;
        repliedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    /** 工单行 + 售后摘要（无关联时各字段为 null） */
    private withAfterSalesView;
    adminTickets(ctx: RequestContext, status?: string, skip?: number, take?: number, source?: string, assigneeId?: ID): Promise<{
        items: ({
            customerName: string;
            customerPhone: string | null;
            afterSalesRequestId: number | null;
            afterSalesState: null;
            afterSalesType: null;
            afterSalesRefundAmount: null;
            afterSalesActualRefundAmount: null;
            channelId: ID;
            customerId: number | null;
            orderCode: string | null;
            orderId: number | null;
            source: string;
            dedupeKey: string | null;
            assigneeId: number | null;
            category: string;
            content: string;
            images: string[] | null;
            status: string;
            reply: string | null;
            repliedBy: string | null;
            repliedAt: Date | null;
            id: ID;
            createdAt: Date;
            updatedAt: Date;
        } | {
            customerName: string;
            customerPhone: string | null;
            afterSalesRequestId: number | null;
            afterSalesState: any;
            afterSalesType: any;
            afterSalesRefundAmount: number | null;
            afterSalesActualRefundAmount: number | null;
            channelId: ID;
            customerId: number | null;
            orderCode: string | null;
            orderId: number | null;
            source: string;
            dedupeKey: string | null;
            assigneeId: number | null;
            category: string;
            content: string;
            images: string[] | null;
            status: string;
            reply: string | null;
            repliedBy: string | null;
            repliedAt: Date | null;
            id: ID;
            createdAt: Date;
            updatedAt: Date;
        })[];
        total: number;
    }>;
    /**
     * 运营手工关联售后单（建单自动关联未命中时使用，如售后单在工单之后才发起）。
     * 校验同一店铺、同一订单，防止把工单挂到无关售后单。
     */
    linkTicketAfterSales(ctx: RequestContext, id: ID, afterSalesRequestId: ID): Promise<{
        afterSalesRequestId: number | null;
        afterSalesState: null;
        afterSalesType: null;
        afterSalesRefundAmount: null;
        afterSalesActualRefundAmount: null;
        channelId: ID;
        customerId: number | null;
        orderCode: string | null;
        orderId: number | null;
        source: string;
        dedupeKey: string | null;
        assigneeId: number | null;
        category: string;
        content: string;
        images: string[] | null;
        status: string;
        reply: string | null;
        repliedBy: string | null;
        repliedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    } | {
        afterSalesRequestId: number | null;
        afterSalesState: any;
        afterSalesType: any;
        afterSalesRefundAmount: number | null;
        afterSalesActualRefundAmount: number | null;
        channelId: ID;
        customerId: number | null;
        orderCode: string | null;
        orderId: number | null;
        source: string;
        dedupeKey: string | null;
        assigneeId: number | null;
        category: string;
        content: string;
        images: string[] | null;
        status: string;
        reply: string | null;
        repliedBy: string | null;
        repliedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * 售后状态联动：售后单退款到账后自动关闭关联工单（回复留痕），
     * 避免工单长期 open、运营重复联系顾客。仅处理 Refunded，其余状态工单保持原状交给运营跟。
     */
    onAfterSalesStateChange(ctx: RequestContext, requestId: number, toState: string): Promise<void>;
    /** 运营回复（replied）/ 关闭（closed）；回复内容必填（关闭时可选沿用原回复） */
    replyTicket(ctx: RequestContext, id: ID, reply: string | undefined, status?: string): Promise<{
        status: string;
        reply: string | null;
        channelId: ID;
        customerId: number | null;
        orderCode: string | null;
        orderId: number | null;
        afterSalesRequestId: number | null;
        source: string;
        dedupeKey: string | null;
        assigneeId: number | null;
        category: string;
        content: string;
        images: string[] | null;
        repliedBy: string | null;
        repliedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /** 回复同步到售后协商留言（售后单已关闭/插件未装时仅告警，不影响工单处理） */
    private forwardReplyToAfterSales;
    createAppeal(ctx: RequestContext, input: {
        orderId?: ID | null;
        reason: string;
        images?: string[] | null;
    }): Promise<any>;
    myAppeals(ctx: RequestContext, skip?: number, take?: number): Promise<CampusRiderAppeal[]>;
    adminAppeals(ctx: RequestContext, status?: string, skip?: number, take?: number): Promise<{
        items: {
            riderName: any;
            riderPhone: string | null;
            channelId: ID;
            riderCustomerId: ID;
            orderId: number | null;
            orderCode: string | null;
            reason: string;
            images: string[] | null;
            status: string;
            creditDelta: number;
            reviewNote: string | null;
            reviewedBy: string | null;
            reviewedAt: Date | null;
            id: ID;
            createdAt: Date;
            updatedAt: Date;
        }[];
        total: number;
    }>;
    /** 审核申诉：通过则按 creditDelta 回补信用分（默认 10），拒绝不回补 */
    reviewAppeal(ctx: RequestContext, id: ID, approve: boolean, creditDelta?: number | null, note?: string | null): Promise<{
        status: string;
        creditDelta: number;
        channelId: ID;
        riderCustomerId: ID;
        orderId: number | null;
        orderCode: string | null;
        reason: string;
        images: string[] | null;
        reviewNote: string | null;
        reviewedBy: string | null;
        reviewedAt: Date | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    listBlacklist(ctx: RequestContext, skip?: number, take?: number): Promise<{
        items: CampusBlacklist[];
        total: number;
    }>;
    addBlacklist(ctx: RequestContext, input: {
        type: string;
        value: string;
        reason?: string | null;
    }): Promise<any>;
    /**
     * 批量导入黑名单（P3-2）：type=phone 时 values 为手机号列表；type=user 时为用户 ID 列表。
     * 去重后逐条入库；已存在且生效的计入 skipped，格式非法/不属于本店铺的计入 invalid。
     * 单次上限 500 条，避免一次性长事务。
     */
    importBlacklist(ctx: RequestContext, type: string, values: string[], reason?: string | null): Promise<{
        added: number;
        skipped: number;
        invalid: number;
    }>;
    removeBlacklist(ctx: RequestContext, id: ID): Promise<{
        ok: boolean;
    }>;
}
