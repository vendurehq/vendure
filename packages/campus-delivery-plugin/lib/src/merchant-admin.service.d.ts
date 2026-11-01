import { ModuleRef } from '@nestjs/core';
import { ID, OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusConfigService } from './campus-config.service';
import { CampusDedupeService } from './campus-dedupe.service';
import { CampusNotifyService } from './campus-notify.service';
import { BusinessTransition } from './business-hours';
import { ExternalProviderCode } from './route-matrix';
import { HallService } from './hall.service';
import { ThirdPartyDeliveryService } from './third-party-delivery.service';
import { CloudPrintService } from './cloud-print.service';
import { FeishuClient } from './feishu/feishu.client';
import { PrivacyNumberService } from './privacy-number.service';
import { ClosureDate } from './closure-calendar';
import { BatchOrderResult } from './batch-orders';
export interface MerchantBoardLine {
    name: string;
    quantity: number;
    price: number;
}
export interface MerchantBoardOrder {
    id: string;
    code: string;
    createdAt: Date;
    total: number;
    shipping: number;
    building: string;
    zone: string;
    slotText: string;
    route: string;
    riderName: string | null;
    note: string | null;
    printedAt: Date | null;
    provider: string | null;
    thirdPartyNo: string | null;
    handoverCode: string | null;
    /** 顾客手机号（脱敏，与号码保护同口径）：工作台检索用，不返回明文 */
    customerPhone: string | null;
    /** 顾客催单待处理（§78）：顾客催过且商家尚未「已知晓」 */
    urged: boolean;
    /** 顾客最近一次催单时间（null=从未催单） */
    urgedAt: Date | null;
    lines: MerchantBoardLine[];
}
/** 今日已完成订单明细（§75）：商家对账用，含退款与实收 */
export interface MerchantCompletedOrder {
    id: string;
    code: string;
    /** 送达时间（对账归时点；历史脏数据可能为 null） */
    deliveredAt: Date | null;
    createdAt: Date;
    /** 订单总额（与工作台「今日完成金额」同口径） */
    total: number;
    /** 该单已退金额（排除 Failed 退款单） */
    refundAmount: number;
    /** 实收 = total - refundAmount */
    netAmount: number;
    /** 剩余可退金额（分，§76）：已支付 − 已退；0 = 已全额退款或未支付 */
    refundable: number;
    building: string;
    zone: string;
    route: string;
    riderName: string | null;
    /** 顾客手机号（脱敏，号码保护同口径） */
    customerPhone: string | null;
    /** 商品摘要：宫保鸡丁×1、米饭×2 */
    lineText: string;
    note: string | null;
}
/** 已完成订单列表 + 区间汇总（§75 对账） */
export interface MerchantCompletedOrders {
    items: MerchantCompletedOrder[];
    /** 区间内已完成单量（不受分页影响） */
    total: number;
    /** 区间内订单总额 */
    totalAmount: number;
    /** 区间内退款总额 */
    refundAmount: number;
    /** 区间内实收总额 */
    netAmount: number;
    /** 客单价 = 实收 / 单量（取整） */
    avgTicket: number;
    /** 实际查询区间（回显给前端） */
    start: Date;
    end: Date;
}
/** 商家发起退款回执（§76） */
export interface MerchantRefundResult {
    ok: boolean;
    /** 本次退款金额（分） */
    amount: number;
    /** 该单累计已退（分，排除 Failed 退款单） */
    refundedTotal: number;
    /** 处理后剩余可退（分） */
    refundable: number;
}
/** 退款记录行（§77 台账）：一笔退款单一行，金额单位分 */
export interface MerchantRefundRow {
    id: string;
    orderId: string;
    code: string;
    /** 退款金额（分） */
    amount: number;
    /** 退款单状态（Pending/Settled/Failed…） */
    state: string;
    /** 退款原因（已去掉「merchant refund (单号):」留痕前缀） */
    reason: string;
    /** merchant=商家发起 / platform=平台处置（拒单、异常处置、无人接单等） */
    source: string;
    createdAt: Date;
    building: string;
    zone: string;
}
/** 退款记录台账 + 区间汇总（§77）：汇总不受分页影响 */
export interface MerchantRefundList {
    items: MerchantRefundRow[];
    /** 区间退款笔数（排除 Failed） */
    count: number;
    /** 区间退款总额（分，排除 Failed） */
    amount: number;
    /** 失败笔数 / 金额（留痕排障用，不计入退款总额） */
    failedCount: number;
    failedAmount: number;
    /** 区间退款单总数（含失败，用于分页） */
    total: number;
    /** 实际查询区间（回显给前端） */
    start: Date;
    end: Date;
}
/** 售后申请行（§81 商家端处理）：金额单位分，顾客可见字段原样回传给商家 */
export interface MerchantAfterSalesRow {
    id: string;
    orderId: string;
    /** 订单号（A2400xxx） */
    orderCode: string;
    /** 售后单状态（Pending/Approved/Rejected/Refunded/RefundFailed/Appealed/Closed…） */
    state: string;
    /** 售后类型（refund_only 仅退款 / return_refund 退货退款 / exchange 换货） */
    type: string;
    /** 顾客选择的售后原因 */
    reason: string;
    /** 顾客补充说明 */
    description: string | null;
    /** 申请退款金额（分） */
    refundAmount: number;
    /** 商家驳回理由（顾客可见） */
    rejectReason: string | null;
    evidenceImages: string[];
    /** 协商留言条数 */
    messageCount: number;
    /** 顾客姓名 */
    customerName: string | null;
    createdAt: Date;
    /** 退款到账时间（未退款为 null） */
    refundedAt: Date | null;
    /** 待处理且已超过渠道处理时限（超时阈值见售后插件 afterSalesTimeoutHours） */
    overdue: boolean;
    /** 最新一条留言来自顾客且商家尚未回复（工作台待回复提醒，无需单独已读表） */
    unread: boolean;
    /** 换货运单号（§83，仅 exchange 且已发货） */
    exchangeTrackingNo: string | null;
    /** 换货承运商（§83） */
    exchangeCarrier: string | null;
    /** 即将超时（§88）：仍在处理时限内，但剩余时间小于渠道临期提醒阈值 */
    dueSoon: boolean;
    /** 售后标签名（§88）：本店自定义标签，按创建先后 */
    tags: string[];
    /** 指派处理人（§89）：本店管理员 User id，未指派为 null */
    assigneeUserId: string | null;
    /** 处理人姓名（未指派或未匹配到为 null） */
    assigneeName: string | null;
    /** 风险标记原因（§94）：未标记或已解除为 null */
    riskReason: string | null;
    /** SLA 计时已暂停（§95）：等待顾客配合期间不判超时/临期 */
    slaPaused: boolean;
    /** 当前暂停原因（§96）：未暂停为 null */
    slaPausedReason: string | null;
    /** 已升级平台仲裁且工单未关闭（§96） */
    escalated: boolean;
    /** 已提交大额退款复核、等待其他管理员确认（§99） */
    refundReviewPending: boolean;
    /** 退款失败原因（§110）：仅 RefundFailed 有值，列表直接展示，免进详情排查 */
    refundError: string | null;
}
/** 换货发货结果复用列表行；批量处理逐单结果 */
export interface MerchantAfterSalesBatchResult {
    id: string;
    success: boolean;
    /** 成功后的售后状态，失败为空串 */
    state: string;
    /** 失败原因（成功为空串） */
    message: string;
}
/** 售后报表：区间内的量、退款与逐日趋势（§83） */
export interface MerchantAfterSalesReport {
    from: string;
    to: string;
    /** 区间内新建售后单数 */
    total: number;
    byType: Array<{
        type: string;
        count: number;
    }>;
    byState: Array<{
        state: string;
        count: number;
    }>;
    /** 区间内退款成功单数（按退款时间归集） */
    refunded: number;
    /** 区间内退款金额（分） */
    refundAmount: number;
    /** 区间内创建且当前仍超时的待处理单数 */
    overdue: number;
    /** 逐日趋势（创建量 / 退款额），按校园日 UTC+8 切分 */
    byDay: Array<{
        date: string;
        count: number;
        refunded: number;
        refundAmount: number;
    }>;
    /** 顾客申请原因 Top5（按区间内创建单聚合） */
    reasons: Array<{
        reason: string;
        count: number;
    }>;
    /** 商家驳回原因 Top5（区间内创建单中已填驳回原因的部分） */
    rejectReasons: Array<{
        reason: string;
        count: number;
    }>;
    /** 首次响应时长（分钟）：创建→商家首条留言，无数据为 0 */
    firstResponseAvgMinutes: number;
    firstResponseMaxMinutes: number;
    /** 完结时长（分钟）：创建→Refunded/Closed，无数据为 0 */
    resolveAvgMinutes: number;
    resolveMaxMinutes: number;
    /** 首响目标达标率（百分比，0=未设目标或无数据） */
    firstResponseOnTargetRate: number;
    /** 完结目标达标率（百分比，0=未设目标或无数据） */
    resolveOnTargetRate: number;
    /** 超出首响目标的单数 / 超出完结目标的单数 */
    firstResponseOverdue: number;
    resolveOverdue: number;
    /** 上一周期（同等长度）对照（§90）：新建单数 / 退款单数 / 退款金额 / 超时单数 */
    previousTotal: number;
    previousRefunded: number;
    previousRefundAmount: number;
    previousOverdue: number;
}
/** 本店拉黑顾客（§90）：仅商家可见 */
export interface MerchantAfterSalesBlacklistEntry {
    id: string;
    customerId: string | null;
    customerName: string | null;
    /** 手机号（脱敏） */
    phone: string | null;
    reason: string | null;
    createdBy: string;
    createdAt: Date;
}
/** 处理人负载（§91）：未完结 / 超时 / 临期 单数，userId=0 表示未指派 */
export interface MerchantAfterSalesAssigneeLoad {
    assigneeUserId: string;
    assigneeName: string;
    openCount: number;
    overdueCount: number;
    dueSoonCount: number;
}
/** 商家售后内部备注（§86）：仅商家可见，顾客端不展示 */
export interface MerchantAfterSalesNote {
    id: string;
    content: string;
    createdBy: string;
    createdAt: Date;
}
/** 售后规则配置（§84）：渠道自定义字段，0 表示关闭自动化 */
export interface MerchantAfterSalesRules {
    /** 待处理超时提醒小时 */
    timeoutHours: number;
    /** 超时自动同意小时（0=关闭） */
    autoApproveHours: number;
    /** 退款失败自动重试次数（0=关闭） */
    refundAutoRetry: number;
    /** 首响目标小时（0=未设） */
    firstResponseTargetHours: number;
    /** 完结目标小时（0=未设） */
    resolveTargetHours: number;
    /** 临期提醒小时（0=关闭，§88） */
    dueSoonHours: number;
    /** 大额退款复核阈值（分，0=关闭，§99） */
    refundReviewThreshold: number;
}
/** 售后操作审计行（§100）：统一操作留痕，按处理人/动作/时间可检索导出 */
export interface MerchantAfterSalesAuditRow {
    id: string;
    requestId: string;
    orderCode: string | null;
    action: string;
    actorUserId: string | null;
    actorName: string | null;
    detail: string | null;
    createdAt: Date;
}
/** 值班条目（§100）：weekday 0=周日，分钟区间，跨零点 endMin>1440 */
export interface MerchantAfterSalesDutyEntry {
    weekday: number;
    startMin: number;
    endMin: number;
    userId: string;
    userName: string | null;
}
/** 补偿挽留方案（§100）：部分退款 + 优惠券补偿 */
export interface MerchantAfterSalesCompensationPlan {
    id: string;
    name: string;
    /** 退款金额（分，0=只发券） */
    refundAmount: number;
    /** 优惠券模板 id（空=不发券） */
    couponTemplateId: string | null;
    note: string | null;
    enabled: boolean;
    createdAt: Date;
}
/** 发放补偿结果（§100） */
export interface MerchantAfterSalesCompensationResult {
    ok: boolean;
    /** 本次部分退款金额（分） */
    refundAmount: number;
    /** 是否成功发放补偿券 */
    couponGranted: boolean;
    /** 结果说明（发券失败等降级原因） */
    message: string;
}
/** 商家快捷回复模板（§87）：本店渠道共用 */
export interface MerchantAfterSalesReplyTemplate {
    id: string;
    content: string;
    createdAt: Date;
    /** 分类标签（§97 知识库），未分类为 null */
    category: string | null;
    /** 检索关键词（空格分隔，§97） */
    keywords: string | null;
    /** 排序权重：越小越靠前（§97） */
    sortOrder: number;
}
/** 退款流水（§84）：按退款时间倒序 */
export interface MerchantAfterSalesRefundRow {
    id: string;
    orderCode: string | null;
    type: string;
    reason: string;
    /** 实际退款金额（分） */
    amount: number;
    refundedAt: Date | null;
    refundTransactionId: string | null;
}
export interface MerchantAfterSalesRefundList {
    items: MerchantAfterSalesRefundRow[];
    total: number;
}
/** 售后自动化任务（§85）：定时提醒/自动同意/退款重试的运行记录 */
export interface MerchantAfterSalesTaskRow {
    id: string;
    type: string;
    requestId: number;
    status: string;
    dueAt: Date;
    attempt: number;
    maxAttempt: number;
    retryCount: number;
    lastError: string | null;
    executedAt: Date | null;
}
export interface MerchantAfterSalesTaskList {
    items: MerchantAfterSalesTaskRow[];
    total: number;
}
/** 高频售后顾客（§85）：手机号脱敏展示 */
export interface MerchantAfterSalesTopCustomer {
    customerId: string;
    name: string;
    phone: string;
    count: number;
    /** 区间内退款额（分） */
    refundAmount: number;
    blacklisted: boolean;
}
/** 售后状态计数（§81）：列表筛选旁的角标 */
export interface MerchantAfterSalesStateCount {
    state: string;
    count: number;
}
/** 售后申请清单（§81）：待处理数不受列表筛选影响，供入口红点 */
export interface MerchantAfterSalesList {
    items: MerchantAfterSalesRow[];
    /** 待商家处理数（Pending + Appealed），不受筛选影响 */
    pendingCount: number;
    /** 当前筛选条件命中总数 */
    total: number;
    /** 全店各状态计数（不受 state 筛选影响） */
    stateCounts: MerchantAfterSalesStateCount[];
    skip: number;
    take: number;
}
/** 售后列表筛选条件（§81） */
export interface MerchantAfterSalesListOptions {
    type?: string | null;
    /** 订单号模糊匹配（A2400xxx） */
    orderCode?: string | null;
    /** 顾客关键字（手机号/姓名模糊匹配，§87） */
    keyword?: string | null;
    /** 标签筛选（本店标签 id，§88） */
    tag?: string | null;
    /** 处理人筛选（本店管理员 userId；'none'=未指派，§89） */
    assignee?: string | null;
    /** 留言关键词（§91）：搜索顾客与商家协商留言内容 */
    messageKeyword?: string | null;
    /** 快捷筛选（§91）：overdue=已超时 / dueSoon=临期 / unread=顾客留言未回复 */
    attention?: string | null;
    /** 金额下界（分，按退款金额筛选，§92） */
    minAmount?: number | null;
    /** 金额上界（分，§92） */
    maxAmount?: number | null;
    /** 风险筛选（§94）：'flagged'=仅已标记风险的售后单 */
    risk?: string | null;
    /** 申请时间下界（YYYY-MM-DD 或 ISO） */
    from?: string | null;
    /** 申请时间上界（YYYY-MM-DD 含当天 / ISO） */
    to?: string | null;
    skip?: number | null;
    take?: number | null;
}
/** 协商留言行（§81 商家端）：顾客与商家双向可见 */
export interface MerchantAfterSalesMessage {
    id: string;
    /** customer=顾客 / admin=商家 */
    senderType: string;
    senderName: string;
    content: string;
    images: string[];
    createdAt: Date;
}
/** 状态流转历史行（售后时间线） */
export interface MerchantAfterSalesHistoryRow {
    fromState: string | null;
    toState: string;
    createdAt: Date;
    /** 处理人 User id（顾客/系统路径为 null，§88） */
    operatorUserId: string | null;
    /** 处理人姓名（管理员，未匹配到为 null） */
    operatorName: string | null;
}
/** 收货地址（售后详情：商家确认退货/换货时核对） */
export interface MerchantAfterSalesAddress {
    fullName: string;
    phoneNumber: string;
    address: string;
}
/** 订单商品行（售后详情：协商退货/部分退款核对） */
export interface MerchantAfterSalesLine {
    name: string;
    quantity: number;
    /** 行单价（含税，分） */
    unitPrice: number;
}
/** 指派变更记录（§92）：谁把售后单指派给谁；§99 起支持转交原因 */
export interface MerchantAfterSalesAssignLogRow {
    fromUserId: string | null;
    fromName: string | null;
    toUserId: string | null;
    toName: string | null;
    /** 转交原因（普通指派/取消指派为 null，§99） */
    reason: string | null;
    createdAt: Date;
}
/** 商品售后统计（§92）：区间内某商品的售后单量/退款与售后率 */
export interface MerchantAfterSalesProductRow {
    productId: string;
    productName: string;
    requestCount: number;
    refundCount: number;
    refundAmount: number;
    /** 售后率（百分比）：售后单数 / 该商品区间订单数，无订单为 0 */
    requestRate: number;
}
/** 售后原因分布（§93）：区间内按原因聚合的单量/退款与环比 */
export interface MerchantAfterSalesReasonRow {
    reason: string;
    /** 该原因售后单量 */
    requestCount: number;
    /** 其中已退款单量 */
    refundCount: number;
    /** 退款金额（分，仅已退款单） */
    refundAmount: number;
    /** 占比（百分比）：该原因单量 / 区间总单量 */
    share: number;
    /** 上一等长区间同原因单量（环比用） */
    previousCount: number;
    /** 环比变化（百分比，上一期为 0 时为 null） */
    changeRate: number | null;
}
/** 顾客最近售后单（§93） */
export interface MerchantAfterSalesCustomerRecent {
    id: string;
    orderCode: string;
    type: string;
    state: string;
    /** 申请退款金额（分） */
    amount: number;
    createdAt: Date;
}
/** 顾客售后档案（§93）：本店维度聚合 */
export interface MerchantAfterSalesCustomerProfile {
    customerId: string;
    name: string;
    /** 手机号（脱敏） */
    phone: string | null;
    blacklisted: boolean;
    requestCount: number;
    refundedCount: number;
    /** 累计退款金额（分，仅已退款单） */
    refundAmount: number;
    firstAt: Date | null;
    lastAt: Date | null;
    /** 最近 10 条售后单 */
    recent: MerchantAfterSalesCustomerRecent[];
}
/** 售后详情（§81）：列表行 + 协商留言 + 状态时间线 + 退款失败留痕 */
export interface MerchantAfterSalesDetail {
    request: MerchantAfterSalesRow;
    messages: MerchantAfterSalesMessage[];
    messageTotal: number;
    stateHistory: MerchantAfterSalesHistoryRow[];
    /** 退款失败原因（RefundFailed 留痕） */
    refundError: string | null;
    /** 实际退款到账金额（分，未退款为 null） */
    actualRefundAmount: number | null;
    /** 渠道处理时限（小时），用于前端展示超时口径 */
    timeoutHours: number;
    /** 顾客手机号（协商退货/换货联系用） */
    customerPhone: string | null;
    /** 订单收货地址 */
    shippingAddress: MerchantAfterSalesAddress | null;
    /** 订单商品行 */
    orderItems: MerchantAfterSalesLine[];
    /** 订单实付总额（含税，分） */
    orderTotal: number;
    /** 指派变更历史（§92），按时间倒序 */
    assignHistory: MerchantAfterSalesAssignLogRow[];
    /** 顾客回访记录（§94），按时间倒序 */
    followUps: MerchantAfterSalesFollowUpRow[];
    /** SLA 暂停历史（§96），按暂停时间倒序 */
    slaPauses: MerchantAfterSalesSlaPauseRow[];
    /** 平台仲裁升级记录（§96），按时间倒序 */
    escalations: MerchantAfterSalesEscalation[];
}
/** 顾客回访记录（§94）：电话/线上沟通留痕 */
export interface MerchantAfterSalesFollowUpRow {
    id: string;
    /** 回访方式：phone / wechat / onsite / other */
    method: string;
    /** 回访结果：reached / unreached / refused / other */
    result: string;
    note: string | null;
    /** 下次跟进时间（null=无需再跟） */
    nextAt: Date | null;
    operatorName: string | null;
    createdAt: Date;
}
/** SLA 暂停记录（§96）：起止时间与原因，详情页时间线展示 */
export interface MerchantAfterSalesSlaPauseRow {
    id: string;
    reason: string;
    pausedAt: Date;
    /** 恢复时间（仍在暂停为 null） */
    resumedAt: Date | null;
    /** 本次暂停时长（毫秒，未恢复为 0） */
    pausedMs: number;
}
/** 平台仲裁升级工单（§96）：商家无法自行处理时转平台客服 */
export interface MerchantAfterSalesEscalation {
    id: string;
    requestId: string;
    reason: string;
    /** normal / urgent */
    priority: string;
    /** Open / Resolved */
    status: string;
    createdBy: string | null;
    creatorName: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    resolution: string | null;
}
/** 线下退款登记回执（§94）：不触发支付网关，直接置为已退款 */
export interface MerchantAfterSalesOfflineRefundResult {
    id: string;
    state: string;
    /** 本次登记退款金额（分） */
    actualRefundAmount: number;
    /** 登记后退款到账时间 */
    refundedAt: Date;
}
/** 售后处理统计（§81）：入口红点 + 今日处理量 + 今日退款额 */
export interface MerchantAfterSalesStats {
    /** 待商家处理（Pending + Appealed） */
    pending: number;
    /** 待处理中已超时的单数 */
    overdue: number;
    /** 渠道处理时限（小时） */
    timeoutHours: number;
    /** 今日已处理售后单数（状态流转到 Approved/Rejected/Refunded） */
    todayHandled: number;
    /** 今日退款成功单数 */
    todayRefunded: number;
    /** 今日退款金额（分） */
    todayRefundAmount: number;
    /** 待商家回复的售后会话数（最新留言来自顾客） */
    pendingReply: number;
    /** 临期未处理单数（§88） */
    dueSoon: number;
    /** 渠道临期提醒阈值（小时，0=关闭） */
    dueSoonHours: number;
}
/** 售后标签（§88）：本店渠道自定义 */
export interface MerchantAfterSalesTag {
    id: string;
    name: string;
    /** 当前打标单数 */
    usedCount: number;
}
/** 售后处理人候选（§89）：本店渠道管理员 */
export interface MerchantAfterSalesAssignee {
    /** 管理员 User id（指派时传该值） */
    id: string;
    name: string;
    /** 登录账号 */
    identifier: string;
}
/** 员工处理绩效（§89）：按操作人统计 */
export interface MerchantAfterSalesStaffRow {
    operatorUserId: string;
    operatorName: string;
    /** 处理过的售后单数（去重） */
    handled: number;
    /** 推进到完结（Refunded/Closed）的单数 */
    resolved: number;
    /** 首次操作距申请的平均分钟 */
    firstActionAvgMinutes: number;
    /** 完结操作距申请的平均分钟（无完结为 0） */
    resolveAvgMinutes: number;
    /** 经手单中当前仍超时未处理的单数（§97） */
    overdueCount: number;
    /** 经手单中已升级平台仲裁的单数（§97） */
    escalatedCount: number;
    /** 完结率（百分比 0-100，§97） */
    resolveRate: number;
    /** 经手单收到的满意度评分数（§98，按评价时间归集） */
    reviewCount: number;
    /** 经手单满意度平均分（保留 1 位小数，无评分为 0，§98） */
    reviewAvgScore: number;
}
/** 售后 CSV 导出筛选（§97）：空值表示不筛选 */
export interface MerchantAfterSalesExportFilter {
    /** 售后单状态或升级工单状态 */
    state?: string | null;
    /** 售后类型（refund_only / return_refund / exchange） */
    type?: string | null;
    /** 订单号 / 申请原因 / 驳回原因模糊检索 */
    keyword?: string | null;
    /** 指派处理人 User id */
    assigneeUserId?: string | null;
}
/** 商品维度售后行（§98）：按商品聚合件数口径售后率与退款额（区别于 §92 的订单数口径） */
export interface MerchantAfterSalesProductRateRow {
    productId: string;
    productName: string;
    /** 区间内下单件数（不含已取消订单） */
    soldQuantity: number;
    /** 区间内售后单数 */
    requestCount: number;
    /** 区间内已退款单数 */
    refundCount: number;
    /** 区间内退款金额（分） */
    refundAmount: number;
    /** 售后率（百分比，保留 1 位小数） */
    afterSalesRate: number;
}
/** 商品维度售后分析（§98）：Top 列表 + 区间汇总 */
export interface MerchantAfterSalesProductRateAnalysis {
    items: MerchantAfterSalesProductRateRow[];
    totalRequests: number;
    totalRefundAmount: number;
    totalSold: number;
}
/** 退货物流轨迹节点（§98） */
export interface MerchantAfterSalesReturnLogisticsEvent {
    /** approved / shipped / picked_up / in_transit / delivered / exception / closed */
    status: string;
    description: string;
    occurredAt: Date;
    /** system=系统按状态派生 / merchant=商家登记 */
    source: string;
}
/** 退货物流（§98）：运单信息 + 轨迹时间线 */
export interface MerchantAfterSalesReturnLogistics {
    requestId: string;
    orderCode: string;
    type: string;
    state: string;
    trackingNo: string | null;
    carrier: string | null;
    events: MerchantAfterSalesReturnLogisticsEvent[];
}
/** 售后自动分流规则（§98） */
export interface MerchantAfterSalesAutoRule {
    id: string;
    name: string;
    /** 匹配优先级：越小越先命中 */
    priority: number;
    enabled: boolean;
    /** * 或售后类型 */
    matchType: string;
    /** 申请原因关键词（空=不限） */
    matchReason: string | null;
    minAmount: number | null;
    maxAmount: number | null;
    /** approve / reject / escalate */
    action: string;
    /** 驳回时给顾客看的原因（仅 reject） */
    rejectReason: string | null;
    createdAt: Date;
}
/** 大额退款复核记录（§99）：达到阈值时需另一位管理员确认后才执行退款 */
export interface MerchantAfterSalesRefundReview {
    id: string;
    requestId: string;
    orderId: string;
    orderCode: string;
    /** 待退款金额（分） */
    amount: number;
    /** Pending / Approved / Rejected */
    status: string;
    requestedBy: string | null;
    requestedByName: string | null;
    requestedAt: Date;
    reviewedBy: string | null;
    reviewedByName: string | null;
    reviewedAt: Date | null;
    note: string | null;
    /** 当前登录管理员是否为申请人（是则不能自行复核） */
    selfRequested: boolean;
}
/** 智能话术推荐（§99）：按售后类型/原因匹配本店快捷回复模板 */
export interface MerchantAfterSalesSuggestedReply {
    id: string;
    content: string;
    /** 匹配得分（0=无关键词命中，仅按排序兜底推荐） */
    score: number;
}
/** 售后工作台摘要（§88）：一次返回各待办入口计数与最老待处理时长 */
export interface MerchantAfterSalesWorkbench {
    /** 待同意（Pending + Appealed） */
    toApprove: number;
    /** 待收货（Returning） */
    toReceive: number;
    /** 退款失败待人工 */
    refundFailed: number;
    /** 待回复留言 */
    pendingReply: number;
    /** 已超时待处理 */
    overdue: number;
    /** 临期未处理 */
    dueSoon: number;
    /** SLA 计时已暂停的待处理单（§95） */
    slaPaused: number;
    /** 回访到期未跟进单数（§95） */
    followUpDue: number;
    /** 已升级平台仲裁且未关闭的单数（§96） */
    escalated: number;
    /** 最早一笔待处理单的申请时间（无待处理为 null） */
    oldestPendingAt: Date | null;
    /** 最老待处理单已等待小时数 */
    oldestPendingHours: number;
}
export interface MerchantBoard {
    paused: boolean;
    /** 营业时段内且未临时休息（与 C 端 openNow 同口径，自动开关门生效依据） */
    openNow: boolean;
    /** 本店营业时间（Channel 自定义字段，空=全天营业） */
    businessHours: string | null;
    /** 下一次自动开门/打烊（null=全天营业或未配置） */
    nextTransition: BusinessTransition | null;
    merchantConfirmEnabled: boolean;
    printMode: 'off' | 'onPaid' | 'onAccepted';
    /** 打印通道（P1-4）：local=前端 C-Lodop；feie/yilianyun=服务端云打印 */
    printProvider: string;
    /** 云通道是否已配齐账号/设备/密钥（未配齐时前端提示去配置） */
    cloudPrintConfigured: boolean;
    storeName: string;
    storePhone: string | null;
    pending: MerchantBoardOrder[];
    cooking: MerchantBoardOrder[];
    awaitingRider: MerchantBoardOrder[];
    delivering: MerchantBoardOrder[];
    pendingDispatch: MerchantBoardOrder[];
    thirdParty: MerchantBoardOrder[];
    ownedPool: MerchantBoardOrder[];
    ownedDispatched: MerchantBoardOrder[];
    merchantDelivering: MerchantBoardOrder[];
    scheduled: MerchantBoardOrder[];
    completedToday: number;
    completedTodayAmount: number;
    /** 今日休业（§70 营业日历）：true 时 C 端「今日休业」且禁止下单 */
    closedToday: boolean;
    /** 今日休业备注（如「国庆假期」），null=无备注或未休业 */
    closureNote: string | null;
    /** 未出餐订单数（§71）：待接单 + 备餐中，休业日提示商家尽快处理 */
    unfinishedOrders: number;
    /** 待处理顾客催单数（§78）：顾客催过且商家未「已知晓」的活跃单数 */
    urgedCount: number;
    /** 待处理售后单数（§83 今日待办）：Pending + Appealed */
    afterSalesPending: number;
    /** 退款失败售后单数（§83 今日待办）：需商家人工重试 */
    refundFailed: number;
    /** 出餐超时订单数（§83 今日待办）：待接单/备餐中等待 ≥25 分钟，口径与出餐屏 late 一致 */
    overdueOrders: number;
    /** 日报未推送（§118 今日待办）：已开启推送、已过设定时间且今日尚未推送成功 */
    dailyPushPending: boolean;
}
/** 商家自助经营：门店资料（营业时间存 Channel.customFields，与 C 端展示/下单闸门同源） */
export interface MerchantStoreProfile {
    storeName: string;
    businessHours: string | null;
    storeNotice: string | null;
    storePhone: string | null;
    paused: boolean;
    openNow: boolean;
    /** 今日是否休业（§70 营业日历）：true 时 C 端展示「今日休业」并禁止下单 */
    closedToday: boolean;
    /** 今日休业备注（如「国庆假期」），null=无备注或未休业 */
    closureNote: string | null;
    /** 已登记的休业日期（校园时区自然日，升序；已过去的日期不再返回） */
    closureDates: ClosureDate[];
    /** 下一次自动开门/打烊（null=全天营业或未配置），供经营设置页倒计时与打烊前提醒 */
    nextTransition: BusinessTransition | null;
    /** 未出餐订单数（§71）：待接单 + 备餐中，休业日提示商家尽快处理 */
    unfinishedOrders: number;
    /** 每日日报推送开关（§86）：营业结束后把昨日日报推到店铺群 */
    dailyPushEnabled: boolean;
    /** 日报推送时间 'HH:MM'，默认 21:30 */
    dailyPushTime: string;
    /** 推送渠道是否可用（§118）：false 时设置页提示「未配置推送渠道，请联系运营」 */
    dailyPushChannelReady: boolean;
    /** 最近一次推送失败时间（epoch ms，§119）：0 = 无可见失败 */
    dailyPushLastFailAt: number;
    /** 最近一次推送失败原因（≤200 字，§119）：空 = 无可见失败 */
    dailyPushLastFailReason: string;
    /** 售后月度摘要推送开关（§95） */
    monthlyPushEnabled: boolean;
    /** 月度推送日（1-28，默认 1） */
    monthlyPushDay: number;
    /** 月度推送时间 'HH:MM'，默认 21:30 */
    monthlyPushTime: string;
    /** 售后自动分配开关（§96） */
    autoAssignEnabled: boolean;
    /** 自动分配单人未完结上限（0=不限） */
    autoAssignMax: number;
    /** 售后异常预警推送开关（§96） */
    alertEnabled: boolean;
    /** 退款率预警阈值（百分比，0=关闭该项） */
    alertRefundRate: number;
    /** 超时待处理预警阈值（单，0=关闭该项） */
    alertOverdueCount: number;
    /** 信任文案（§113）：质量行开关（关=该行不展示） */
    trustQualityEnabled: boolean;
    /** 质量行自定义文案（null=回落 C 端默认文案） */
    trustQualityText: string | null;
    /** 服务行开关 */
    trustServiceEnabled: boolean;
    /** 服务行自定义文案（null=回落默认） */
    trustServiceText: string | null;
    /** 时间行开关 */
    trustTimeEnabled: boolean;
    /** 时间行自定义文案（null=回落默认） */
    trustTimeText: string | null;
}
/** KDS 出餐屏（P1-4）：一单一张票，按等待时长分级提醒 */
export interface KitchenTicketLine {
    name: string;
    quantity: number;
    addons: string[];
}
export interface KitchenTicket {
    id: string;
    code: string;
    stage: 'pending' | 'cooking';
    createdAt: Date;
    waitingMinutes: number;
    /** normal=<15min，warn=15-25min，late=>25min */
    urgency: 'normal' | 'warn' | 'late';
    zone: string;
    building: string;
    slotText: string;
    note: string | null;
    printedAt: Date | null;
    total: number;
    /** 顾客催单待处理（§78）：出餐屏置顶并标「顾客催单」 */
    urged: boolean;
    lines: KitchenTicketLine[];
}
export interface KitchenQueue {
    tickets: KitchenTicket[];
    pendingCount: number;
    cookingCount: number;
    lateCount: number;
    /** 待处理顾客催单数（§78） */
    urgedCount: number;
    warnMinutes: number;
    lateMinutes: number;
}
/** 备餐汇总（§79）：某商品今日份数分布（待接单/备餐中/已出餐）与加料份数 */
export interface MerchantPrepAddon {
    name: string;
    quantity: number;
}
export interface MerchantPrepItem {
    /** 商品/规格名（与小票、出餐屏同口径） */
    name: string;
    /** 待接单份数 */
    pendingQty: number;
    /** 备餐中份数 */
    cookingQty: number;
    /** 今日已出餐（已送达）份数 */
    doneQty: number;
    /** 待做合计 = 待接单 + 备餐中 */
    todoQty: number;
    /** 今日合计 = 待做 + 已做 */
    totalQty: number;
    /** 加料/口味份数（如「加辣 ×3」），按待做 + 已做合并统计 */
    addons: MerchantPrepAddon[];
}
/** 营业日报（§80）：单日时段分布（校园时区 0-23 点） */
export interface MerchantDailyHour {
    hour: number;
    orders: number;
    gross: number;
}
/** 营业日报（§80）：单日商品销量行（销量按份数、金额按折后行小计） */
export interface MerchantDailyProduct {
    name: string;
    qty: number;
    amount: number;
}
/** 营业日报（§80）：对比口径（昨日 / 近 7 日均值） */
export interface MerchantDailyCompare {
    orders: number;
    gross: number;
    avgTicket: number;
}
/** 营业日报（§80）：单日经营快照 */
export interface MerchantDailyReport {
    /** 校园日 key（YYYY-MM-DD） */
    date: string;
    /** 当日已完成（已送达）单量 */
    orders: number;
    /** 当日营业额（分，订单实收总额） */
    gross: number;
    /** 客单价（分） */
    avgTicket: number;
    /** 当日取消单量（按下单日归日，与经营设置页同口径） */
    cancelled: number;
    /** 当日取消退款金额（分，取消单全额） */
    cancelledAmount: number;
    /** 时段分布：今天只出到当前小时，历史日 24 点全出 */
    hourly: MerchantDailyHour[];
    /** 销量 Top5（按份数降序，同份数按金额降序） */
    topProducts: MerchantDailyProduct[];
    /** 前一日同口径 */
    prev: MerchantDailyCompare;
    /** 前 7 日（不含当日）日均 */
    last7Avg: MerchantDailyCompare;
}
/** 出餐屏超时阈值（分钟）：15 分钟预警、25 分钟催单 */
export declare const KDS_WARN_MINUTES = 15;
export declare const KDS_LATE_MINUTES = 25;
/** 经营数据分桶（分）：营业额=窗口内已送达订单实付合计；取消=窗口内取消单（全额退款口径） */
export interface MerchantRevenueBucket {
    orders: number;
    gross: number;
    avgTicket: number;
    cancelled: number;
    cancelledAmount: number;
}
export interface MerchantRevenueDay {
    date: string;
    /** 完整日期 YYYY-MM-DD（自定义导出区间跨年时区分年份） */
    dateFull: string;
    orders: number;
    gross: number;
    cancelled: number;
    cancelledAmount: number;
}
export interface MerchantRevenue {
    today: MerchantRevenueBucket;
    last7: MerchantRevenueBucket;
    days: MerchantRevenueDay[];
    /** P3-2 导出用：近 30 日（含今日）逐日明细，口径与 days 完全一致 */
    days30: MerchantRevenueDay[];
}
/**
 * 商家接单工作台（admin-api，CampusMerchant 权限，渠道隔离 = 商家角色绑定渠道）。
 * 状态机（merchantConfirmEnabled 渠道）：支付 → pending_merchant（待商家接单）
 * → accepted（备餐中，campusMerchantAcceptOrder）→ open（出餐完成入大厅，
 * campusMerchantCookingDone）→ 骑手 grabbed/delivering → delivered。
 */
export declare class MerchantAdminService {
    private connection;
    private config;
    private hall;
    private notify;
    private thirdParty;
    private orderService;
    private privacy;
    private cloud;
    private feishu;
    private moduleRef?;
    /** M5 跨实例冷却/预警去重；未注入退回进程内 Map */
    private dedupe?;
    constructor(connection: TransactionalConnection, config: CampusConfigService, hall: HallService, notify: CampusNotifyService, thirdParty: ThirdPartyDeliveryService, orderService: OrderService, privacy: PrivacyNumberService, cloud: CloudPrintService, feishu: FeishuClient, moduleRef?: ModuleRef | undefined, 
    /** M5 跨实例冷却/预警去重；未注入退回进程内 Map */
    dedupe?: CampusDedupeService | undefined);
    /** 售后插件为可选依赖：未安装时售后清单为空，「售后申请」入口降级隐藏 */
    private afterSalesSvc?;
    /** 退款重试冷却（§82）：同单 30 秒内只放行一次，防连点重复调用退款核心 */
    private refundRetryAt;
    /** 催办顾客冷却（§84）：同单 60 秒内只发一次站内信，防对顾客骚扰 */
    private remindAt;
    /** 补偿券服务缓存（§100）：coupon-plugin 可选依赖 */
    private couponSvc?;
    /** 无人值班预警去重（§100）：channelId:校园日，同一天只预警一次 */
    private dutyWarnAt;
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private getAfterSales;
    /** 补偿券服务（§100）：coupon-plugin 未安装/未启用时返回 null，发券失败降级为仅退款 */
    private getCouponService;
    /** 商家自助经营：门店资料（营业时间/公告/电话/营业状态） */
    storeProfile(ctx: RequestContext): Promise<MerchantStoreProfile>;
    /** 商家自助修改门店资料：营业时间走 Channel 自定义字段，公告/电话走履约配置白名单 */
    updateStore(ctx: RequestContext, input: {
        businessHours?: string | null;
        storeNotice?: string | null;
        storePhone?: string | null;
    }): Promise<MerchantStoreProfile>;
    /**
     * 信任文案（§113）：评价页信任签名卡「质量→服务→时间」三行，店铺级自定义。
     * 未传的项保留原值；文案留空/纯空白 = 回落 C 端默认文案（传 null 即清空自定义）。
     */
    updateTrustCopy(ctx: RequestContext, input: {
        qualityEnabled?: boolean | null;
        qualityText?: string | null;
        serviceEnabled?: boolean | null;
        serviceText?: string | null;
        timeEnabled?: boolean | null;
        timeText?: string | null;
    }): Promise<MerchantStoreProfile>;
    /** 信任文案归一：去空白、超长拒绝、空串转 null（C 端按 null 回落默认文案） */
    private trustText;
    /**
     * 每日日报推送设置（§86）：开关 + 推送时间。
     * - 时间按校园时区解释，格式 HH:MM，空=沿用 21:30；改时间不清 lastDate，同一天不会重复推。
     * - 关闭只改开关，历史 lastDate 保留，重开当天若已推过则不再推（幂等键按「已推送的昨日」记）。
     */
    updateDailyPush(ctx: RequestContext, enabled: boolean, time?: string | null): Promise<MerchantStoreProfile>;
    /**
     * 售后月度摘要推送设置（§95）：开关 + 每月推送日（1-28）+ 推送时间。
     * - 时间按校园时区解释，格式 HH:MM，空=沿用 21:30；推送日空=每月 1 日。
     * - 每月只推一次（按上月 'YYYY-MM' 幂等），改设置不会重复推。
     */
    updateAfterSalesMonthlyPush(ctx: RequestContext, enabled: boolean, day?: number | null, time?: string | null): Promise<MerchantStoreProfile>;
    /**
     * 售后自动化设置（§96）：自动分配 + 异常预警。
     * - 仅更新显式传入的项（null/undefined 保持原值），阈值传 0 表示关闭该项。
     * - autoAssignMax=0 不限制单人未完结单量；refundRate/overdueCount 为 0 时对应预警不触发。
     */
    updateAfterSalesAutomation(ctx: RequestContext, input: {
        autoAssignEnabled?: boolean | null;
        autoAssignMax?: number | null;
        alertEnabled?: boolean | null;
        alertRefundRate?: number | null;
        alertOverdueCount?: number | null;
    }): Promise<MerchantStoreProfile>;
    /** 营业日历（§70）：整体替换休业日期列表（传空数组=关闭休业日历），返回最新门店资料 */
    updateClosureDates(ctx: RequestContext, dates: Array<{
        date?: string | null;
        note?: string | null;
    }> | null): Promise<MerchantStoreProfile>;
    /** 商家自助经营数据：今日/近 7 日（含今日）单量、营业额、客单价、取消退款；另附近 30 日逐日明细供导出 */
    revenue(ctx: RequestContext): Promise<MerchantRevenue>;
    /**
     * 自定义区间逐日经营数据（§89 导出）：含起止两日，最多 366 天。
     * 口径与 revenue() 的 days30 完全一致（送达按 deliveredAt 归日、取消按下单日归日）。
     */
    revenueRange(ctx: RequestContext, from: string, to: string): Promise<MerchantRevenueDay[]>;
    /** 商家侧顾客联系方式（号码保护）：本渠道订单可查，开启后只返回脱敏/虚拟号 */
    customerContact(ctx: RequestContext, orderId: ID): Promise<import("./privacy-number.service").PrivacyContact>;
    /** 本渠道营业时间（Channel.customFields.waimaiBusinessHours）；原生查询，供工作台高频轮询 */
    private channelBusinessHours;
    /**
     * 日报推送状态（§118 今日待办）：「已开启 + 已到点 + 今日未推成功」= 日报未推送。
     * 走原生单行查询（同 channel 表），避免工作台 10s 轮询实例化 Channel 实体。
     */
    private channelDailyPushState;
    /** 本渠道休业日列表（§100 SLA 口径）：含历史日期，供 businessDeadline 整天跳过 */
    private channelClosureDateKeys;
    board(ctx: RequestContext): Promise<MerchantBoard>;
    /**
     * 今日/区间已完成订单明细（§75 对账）：送达口径与工作台「今日完成」一致
     * （customFields.deliveryStatus = 'delivered' + deliveredAt 落区间），
     * 汇总按全区间统计（不受分页影响），退款取该单全部非 Failed 退款单之和。
     */
    completedOrders(ctx: RequestContext, input: {
        from?: string | null;
        to?: string | null;
        take?: number | null;
        skip?: number | null;
    }): Promise<MerchantCompletedOrders>;
    /**
     * 退款记录台账（§77）：按渠道聚合退款单（refund → payment → order），
     * 与 §76 口径一致——Failed 退款单单独计数留痕但不计入退款总额；
     * reason 去掉商家退款留痕前缀（merchant refund (单号):）后再返回。
     */
    refunds(ctx: RequestContext, input: {
        from?: string | null;
        to?: string | null;
        take?: number | null;
        skip?: number | null;
    }): Promise<MerchantRefundList>;
    /** 商家接单确认：pending_merchant → accepted */
    acceptOrder(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
    }>;
    /** 接单内核（手动/自动共用）：条件写防并发 + 用户通知 + 接单即出票；返回是否真正迁移成功 */
    transitionToAccepted(ctx: RequestContext, orderId: ID, trigger: 'manual' | 'auto'): Promise<boolean>;
    /** 商家拒单/商品缺货：接单前（pending_merchant）或备餐中（accepted）可拒，
     * 全额退款 + 取消订单（取消后由 Cancelled 转换自动脱厅/释放时段锁位）。
     * 退款幂等口径与 T4/异常处置一致：先查已退总额，仅退剩余部分。 */
    rejectOrder(ctx: RequestContext, orderId: ID, reason: string): Promise<{
        ok: boolean;
    }>;
    /** 商家发起退款（§76）：已送达订单可整单/部分退款，复用既有 refund 通道。
     * 与拒单/运营异常处置共用订单级咨询锁，避免并发双退。 */
    merchantRefund(ctx: RequestContext, orderId: ID, amount: number, reason: string): Promise<MerchantRefundResult>;
    /** 出餐完成：按路线/承运分流（不再统一入抢单大厅） */
    cookingDone(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
    }>;
    /** 批量接单（§73）：逐单复用单笔接单（含通知/云打印），失败跳过并回报 */
    batchAcceptOrders(ctx: RequestContext, orderIds: ID[]): Promise<BatchOrderResult>;
    /** 批量出餐（§73）：逐单复用单笔出餐分流，失败跳过并回报 */
    batchCookingDone(ctx: RequestContext, orderIds: ID[]): Promise<BatchOrderResult>;
    /** 顺序执行批量动作：单笔失败（状态已变更/已脱厅/退款中等）只记明细，不中断后续单 */
    private runBatch;
    /** 运营中心推送外部快递（选 dada / meituan） */
    dispatchExternal(ctx: RequestContext, orderId: ID, provider: ExternalProviderCode): Promise<{
        ok: boolean;
        already: boolean;
        thirdPartyNo: any;
        provider?: undefined;
    } | {
        ok: boolean;
        thirdPartyNo: any;
        provider: ExternalProviderCode;
        already?: undefined;
    }>;
    /** 取消外部快递（改推另一家 / 回落大厅前） */
    cancelExternal(ctx: RequestContext, orderId: ID, reason?: string): Promise<{
        ok: boolean;
        skipped: boolean;
        reason?: undefined;
    } | {
        ok: boolean;
        reason: string | undefined;
        skipped?: undefined;
    }>;
    /** 自营快递接单（R1 商户超时转自营 / R3 自营池） */
    acceptOwned(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
    }>;
    /** R1：商户把餐送到校园交接点 → 传信者接力 */
    markHandoverArrived(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
        done: boolean;
    }>;
    /** 自营快递送达（R1/R2 到交接点，R3 到学生） */
    markOwnedArrived(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
        done: boolean;
    }>;
    /** 营业开关：商家仅可切换本渠道 paused，其余配置仍归 CampusConfig 管理员 */
    setPaused(ctx: RequestContext, paused: boolean): Promise<{
        ok: boolean;
    }>;
    /** 自动接单设置（§69）：含今日已自动接单数与当前营业条件（休息中自动失效） */
    autoAcceptSettings(ctx: RequestContext): Promise<{
        enabled: boolean;
        delaySeconds: number;
        dailyLimit: number;
        routes: string[];
        acceptedToday: number;
        openNow: boolean;
        merchantConfirmEnabled: boolean;
    }>;
    /** 自动接单设置保存：延迟/上限/路线走配置白名单校验（越界直接报错，不静默截断） */
    updateAutoAccept(ctx: RequestContext, input: {
        enabled: boolean;
        delaySeconds?: number | null;
        dailyLimit?: number | null;
        routes?: string[] | null;
    }): Promise<{
        enabled: boolean;
        delaySeconds: number;
        dailyLimit: number;
        routes: string[];
        acceptedToday: number;
        openNow: boolean;
        merchantConfirmEnabled: boolean;
    }>;
    /** 本店本校园日自动接单数（按 autoAcceptedAt 统计，跨零点自动归零） */
    countAutoAcceptedToday(channelId: ID): Promise<number>;
    /** 小票打印回执：工作台打印成功后回写 waimaiPrintedAt（防重打 + 补打依据），不限订单状态 */
    markPrinted(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
    }>;
    /** 商家确认「已知晓」顾客催单（§78）：只落小表时间戳，不改顾客侧 urged/urgedAt（骑手端仍可见催单标记） */
    ackUrge(ctx: RequestContext, orderId: ID): Promise<{
        ok: boolean;
    }>;
    /** 批量取催单「已知晓」时间（§78）；小表缺失时按未处理兜底，不阻断工作台 */
    private urgeAckMap;
    /** 云打印一张小票（后端签名直连服务商）：成功即回写 printedAt */
    cloudPrint(ctx: RequestContext, orderId: ID): Promise<import("./cloud-print.service").CloudPrintResult>;
    /** 云打印连通性测试（不占用订单） */
    cloudPrintTest(ctx: RequestContext): Promise<import("./cloud-print.service").CloudPrintResult>;
    /** 最近云打印任务（排障） */
    printJobs(ctx: RequestContext, limit?: number): Promise<import("./cloud-print.service").CloudPrintJobRow[]>;
    /** KDS 出餐屏队列：待接单 + 备餐中（按支付先后出票，超时标红） */
    kitchenQueue(ctx: RequestContext): Promise<KitchenQueue>;
    /**
     * 备餐汇总（§79）：今日「待接单 + 备餐中」按商品聚合待做份数，
     * 叠加今日已送达份数，供后厨按份备料；加料/口味按同一商品合并计数。
     * 口径与出餐屏/工作台一致：待做取活跃单（不落小票），已做按送达时间归今日。
     */
    prepSummary(ctx: RequestContext): Promise<MerchantPrepItem[]>;
    /** 营业日报（§80）：单日经营快照 —— KPI、时段分布、商品 Top5、对比昨日与近 7 日均值 */
    dailyReport(ctx: RequestContext, date?: string | null): Promise<MerchantDailyReport>;
    /** 售后申请清单（§81）：只列本店渠道订单的售后单；state 为空=全部 */
    afterSalesList(ctx: RequestContext, state?: string | null, opts?: MerchantAfterSalesListOptions): Promise<MerchantAfterSalesList>;
    /**
     * 同意售后（§81）：refund_only 由售后插件链式 Received → 退款到账，商家一次操作即闭环；
     * 先按「本店渠道 + 待处理」校验，避免越权或已处理单重复触发退款。
     * 顾客申诉（Rejected → Appealed）后商家仍可同意（appealRequest 已把申诉说明写入留言流）。
     * §99：退款金额达到渠道复核阈值时只登记待复核，由另一位管理员确认后才真正退款。
     */
    afterSalesApprove(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesRow>;
    /**
     * 大额退款复核门槛（§99）：返回「需要复核」的售后单及申请退款金额。
     * 阈值为 0 或单金额低于阈值时无需复核，保持原直退链路。
     */
    private refundReviewGate;
    /** 登记待复核（§99）：同一售后单仅保留一条 Pending 记录（部分唯一索引兜底幂等） */
    private createRefundReview;
    /** 大额退款复核队列（§99）：默认只列待复核，附订单号与申请人/复核人姓名 */
    afterSalesRefundReviews(ctx: RequestContext, status?: string | null): Promise<MerchantAfterSalesRefundReview[]>;
    /**
     * 复核大额退款（§99）：approve=true 才真正调用售后插件退款，false=驳回复核（售后单保持待处理）。
     * 必须由另一位管理员复核；申请人为空（系统登记）不受此限制。
     */
    afterSalesResolveRefundReview(ctx: RequestContext, id: ID, approve: boolean, note?: string | null): Promise<MerchantAfterSalesRefundReview>;
    private refundReviewOne;
    private toRefundReview;
    /** 待复核标记（§99）：列表/详情标出「已提交复核」，避免商家误以为卡单 */
    private refundReviewPendingSet;
    /**
     * 售后详情（§81）：售后单 + 协商留言（含顾客申诉说明）+ 状态时间线 + 退款失败留痕。
     * 渠道隔离同列表；留言表缺失时降级为空列表，不影响详情可用。
     */
    afterSalesDetail(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesDetail>;
    /**
     * 商家确认收到退货（§82）：Returning → Received，退货回补与退款收紧由售后插件同事务完成。
     * 收货备注先写留言流（失败只告警，不阻断收货）。
     */
    afterSalesConfirmReturn(ctx: RequestContext, id: ID, receivedQuantity?: number | null, note?: string | null): Promise<MerchantAfterSalesRow>;
    /**
     * 售后退款失败重试（§82）：仅 RefundFailed 可重试，复用售后插件退款核心（按剩余可退额度继续退）。
     * 30 秒内同单只放行一次，避免连点造成重复退款尝试。
     */
    afterSalesRetryRefund(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesRow>;
    /**
     * 换货发货（§83）：Received → ExchangeShipped，仅 exchange 类型可走。
     * 换货完成由顾客在本端确认收货（插件 exchangeReceive 校验归属），商家不代确认。
     */
    afterSalesExchangeShip(ctx: RequestContext, id: ID, trackingNo: string, carrier?: string | null): Promise<MerchantAfterSalesRow>;
    /** 批量同意（§83）：仅处理本渠道售后单，单条失败不阻断整批 */
    afterSalesBatchApprove(ctx: RequestContext, ids: ID[]): Promise<MerchantAfterSalesBatchResult[]>;
    /** 批量驳回（§83）：整批共用一个驳回原因 */
    afterSalesBatchReject(ctx: RequestContext, ids: ID[], reason: string): Promise<MerchantAfterSalesBatchResult[]>;
    /** 读本店售后寄回地址（§83）：供货主/顾客寄回页展示 */
    afterSalesReturnAddress(ctx: RequestContext): Promise<string>;
    /** 写本店售后寄回地址（§83）：长度上限与插件字段一致 */
    updateAfterSalesReturnAddress(ctx: RequestContext, address: string): Promise<boolean>;
    /** 售后规则（§84）：渠道字段，缺省与售后插件默认一致（48h / 0 / 1） */
    afterSalesRules(ctx: RequestContext): Promise<MerchantAfterSalesRules>;
    /**
     * 保存售后规则（§84）：只写传入项，保留渠道其它自定义字段。
     * 超时提醒 1-168h；自动同意 0-168h（0=关闭）；自动重试 0-5 次（0=关闭）；
     * 首响/完结目标 0-168h（0=未设，§87）。
     */
    updateAfterSalesRules(ctx: RequestContext, input: {
        timeoutHours?: number | null;
        autoApproveHours?: number | null;
        refundAutoRetry?: number | null;
        firstResponseTargetHours?: number | null;
        resolveTargetHours?: number | null;
        dueSoonHours?: number | null;
        refundReviewThreshold?: number | null;
    }): Promise<MerchantAfterSalesRules>;
    /** 商家关闭待处理售后（§84）：Pending → Closed，原因必填并回显顾客 */
    afterSalesClose(ctx: RequestContext, id: ID, reason: string): Promise<MerchantAfterSalesRow>;
    /**
     * 暂停售后 SLA 计时（§95/§96）：等待顾客补充资料/回寄等场景，暂停期间不判超时与临期。
     * §96 起暂停原因必填，并写入暂停记录表供详情页时间线展示。
     * 幂等：已暂停时重复调用直接返回当前行（不重复记暂停记录）。
     */
    afterSalesPauseSla(ctx: RequestContext, id: ID, reason?: string | null): Promise<MerchantAfterSalesRow>;
    /**
     * 恢复售后 SLA 计时（§95/§96）：把本次暂停时长累计进 slaPausedMs，截止时间随之后移，
     * 并回填暂停记录表的结束时间与本次时长。幂等：未暂停时重复调用无副作用。
     */
    afterSalesResumeSla(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesRow>;
    /** 批量关闭待处理售后（§95）：单批上限 50，逐单返回结果 */
    afterSalesBatchClose(ctx: RequestContext, ids: ID[], reason: string): Promise<MerchantAfterSalesBatchResult[]>;
    /** 升级平台仲裁（§96）：商家无法自行处理时转平台客服；同一单仅保留一条未关闭工单 */
    afterSalesEscalate(ctx: RequestContext, id: ID, reason: string, priority?: string | null): Promise<MerchantAfterSalesEscalation[]>;
    /** 关闭平台仲裁工单（§96）：平台/商家填写处理结论后置为 Resolved */
    afterSalesEscalationResolve(ctx: RequestContext, id: ID, resolution?: string | null): Promise<MerchantAfterSalesEscalation[]>;
    /**
     * 售后自动分配（§96）：渠道开启后，把未指派的未完结售后单指派给当前未完结量最少的处理人。
     * - 只处理本店渠道订单对应、未结案且尚无指派的售后单，按申请时间先到先得。
     * - autoAssignMax>0 时，最空闲处理人也已达上限则本轮停止，避免压垮个人。
     * - 返回本轮实际指派单数，供定时任务日志。
     */
    afterSalesAutoAssign(ctx: RequestContext): Promise<number>;
    /** 无人值班预警（§100）：值班表非空但当前时段无人，飞书群提醒，同一校园日只发一次 */
    private warnNoDuty;
    /** 商家催办顾客（§84）：60 秒内同单一次，站内信经事件解耦投递 */
    afterSalesRemind(ctx: RequestContext, id: ID, note?: string | null): Promise<MerchantAfterSalesRow>;
    /** 退款流水（§84）：按退款时间倒序分页，日期为校园日（UTC+8），可省略不限 */
    afterSalesRefunds(ctx: RequestContext, opts?: {
        from?: string | null;
        to?: string | null;
        skip?: number | null;
        take?: number | null;
    }): Promise<MerchantAfterSalesRefundList>;
    /** 售后自动化任务列表（§85）：本店渠道，按到期时间倒序 */
    afterSalesTasks(ctx: RequestContext, opts?: {
        status?: string | null;
        skip?: number | null;
        take?: number | null;
    }): Promise<MerchantAfterSalesTaskList>;
    /**
     * 立即执行超时任务（§85）：重置为 PENDING + 到期时间为当前，复用任务锁跑一次，
     * FAILED 任务借此补跑；已执行/已作废不允许重复执行。
     */
    afterSalesRunTask(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesTaskRow>;
    /**
     * 售后明细 / 退款流水 / 升级工单 / 员工绩效导出（§85、§97、§89）：CSV 文本（UTF-8 BOM + 中文表头），单次上限 5000 行，
     * 供前端保存为 .csv；日期为校园日（UTC+8）。filter 支持状态/类型/关键词/处理人筛选。
     */
    afterSalesExport(ctx: RequestContext, from: string, to: string, kind: string, filter?: MerchantAfterSalesExportFilter | null): Promise<string>;
    /** 商品维度售后分析（§98）：区间内按商品聚合下单件数、售后单数与退款额，售后率=售后单/下单件 */
    afterSalesProductAnalysis(ctx: RequestContext, from: string, to: string): Promise<MerchantAfterSalesProductRateAnalysis>;
    /** 退货物流轨迹（§98）：运单信息 + 系统派生节点与商家登记节点合并时间线 */
    afterSalesReturnLogistics(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesReturnLogistics>;
    /** 登记退货物流节点（§98）：商家按快递扫描节点补录，status=picked_up/in_transit/delivered/exception */
    afterSalesRecordReturnLogistics(ctx: RequestContext, id: ID, status: string, description?: string | null): Promise<MerchantAfterSalesReturnLogistics>;
    /** 售后自动分流规则列表（§98）：本店渠道，按优先级升序 */
    afterSalesAutoRules(ctx: RequestContext): Promise<MerchantAfterSalesAutoRule[]>;
    /** 保存售后自动分流规则（§98）：id 为空=新增；action=approve/reject/escalate */
    saveAfterSalesAutoRule(ctx: RequestContext, input: {
        id?: ID | null;
        name: string;
        priority?: number | null;
        enabled?: boolean | null;
        matchType?: string | null;
        matchReason?: string | null;
        minAmount?: number | null;
        maxAmount?: number | null;
        action: string;
        rejectReason?: string | null;
    }): Promise<MerchantAfterSalesAutoRule>;
    /** 删除售后自动分流规则（§98） */
    deleteAfterSalesAutoRule(ctx: RequestContext, id: ID): Promise<boolean>;
    /**
     * 执行自动分流规则（§98）：扫描本店近 7 日未分流过的 Pending 单，按优先级首个命中规则执行
     * approve / reject / escalate，执行后写 autoRuleAppliedAt 防重复（失败也标记，避免每轮重试放大退款风险）。
     */
    applyAfterSalesAutoRules(ctx: RequestContext, limit?: number): Promise<number>;
    /** 高频售后顾客 Top N（§85）：区间内售后次数/退款额，附黑名单状态，手机号脱敏 */
    afterSalesTopCustomers(ctx: RequestContext, from: string, to: string, limit?: number | null): Promise<MerchantAfterSalesTopCustomer[]>;
    /** 一键拉黑高频售后顾客（§85）：仅限在本店有售后记录的顾客，已存在则不重复插入 */
    blacklistAfterSalesCustomer(ctx: RequestContext, customerId: ID, reason?: string | null): Promise<boolean>;
    /** 售后内部备注（§86）：仅本店商家可见，按时间正序 */
    afterSalesNotes(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesNote[]>;
    /** 新增内部备注（§86）：顾客端不可见，仅用于商家交接与留痕 */
    addAfterSalesNote(ctx: RequestContext, id: ID, content: string): Promise<MerchantAfterSalesNote>;
    /** 删除内部备注（§86）：仅本店备注可删 */
    deleteAfterSalesNote(ctx: RequestContext, id: ID, noteId: ID): Promise<boolean>;
    /** 批量催办顾客（§86）：单批上限 20，逐单结果；仍受同单 60 秒冷却约束 */
    afterSalesBatchRemind(ctx: RequestContext, ids: ID[], note?: string | null): Promise<MerchantAfterSalesBatchResult[]>;
    /** 快捷回复模板列表（§87、§97）：本店渠道，支持按分类与关键词检索，排序权重小者靠前 */
    afterSalesReplyTemplates(ctx: RequestContext, options?: {
        category?: string | null;
        keyword?: string | null;
    }): Promise<MerchantAfterSalesReplyTemplate[]>;
    /** 新增 / 修改快捷回复模板（§87、§97）：单店上限 30 条，单条最多 200 字，可设分类/关键词/排序 */
    saveAfterSalesReplyTemplate(ctx: RequestContext, id: ID | null | undefined, content: string, category?: string | null, keywords?: string | null, sortOrder?: number | null): Promise<MerchantAfterSalesReplyTemplate>;
    /** 删除快捷回复模板（§87） */
    deleteAfterSalesReplyTemplate(ctx: RequestContext, id: ID): Promise<boolean>;
    /** 手动为退款失败单排程重试（§87）：复用/复位任务到 PENDING，1 分钟后由兜底扫描执行 */
    afterSalesScheduleRefundRetry(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesTaskRow>;
    /** 售后标签列表（§88）：本店渠道，附当前打标单数 */
    afterSalesTags(ctx: RequestContext): Promise<MerchantAfterSalesTag[]>;
    /** 新增 / 重命名售后标签（§88）：单店上限 20 个，名称最多 12 字 */
    saveAfterSalesTag(ctx: RequestContext, id: ID | null | undefined, name: string): Promise<MerchantAfterSalesTag>;
    /** 删除售后标签（§88）：一并清除本店打标关联 */
    deleteAfterSalesTag(ctx: RequestContext, id: ID): Promise<boolean>;
    /** 设置售后单标签（§88）：整体替换，单次最多 5 个，返回标签名 */
    setAfterSalesTags(ctx: RequestContext, id: ID, tagIds: ID[]): Promise<string[]>;
    /** 批量取某批售后单的标签名（§88）：表缺失时降级为空 */
    private afterSalesTagNames;
    /** 批量取某批售后单的处理人（§89）：表缺失时降级为空 */
    private afterSalesAssigneeMap;
    /** 处理人候选（§89）：本店渠道内有角色权限的管理员 */
    afterSalesAssignees(ctx: RequestContext): Promise<MerchantAfterSalesAssignee[]>;
    /** 指派处理人（§89）：传空=取消指派；处理人必须是本店渠道管理员 */
    afterSalesAssign(ctx: RequestContext, id: ID, userId: ID | null): Promise<MerchantAfterSalesRow>;
    /**
     * 工单转交（§99）：把售后单转给另一位本店管理员，附转交原因并写指派历史，
     * 同时向店铺群推送协作通知（飞书未配置时静默跳过）。
     */
    afterSalesTransfer(ctx: RequestContext, id: ID, userId: ID, reason: string): Promise<MerchantAfterSalesRow>;
    /** 管理员显示名（§99）：firstName + lastName，取不到回退为 null */
    private adminDisplayName;
    /**
     * 智能话术推荐（§99）：按售后类型 + 顾客申请原因匹配本店快捷回复模板，
     * 关键词命中优先、分类命中次之，返回得分最高的 3 条；全部未命中时按排序兜底。
     */
    afterSalesSuggestedReplies(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesSuggestedReply[]>;
    /** 批量打标签（§89）：上限 50 单、5 个标签，逐单返回结果，失败不阻断整批 */
    afterSalesBatchTag(ctx: RequestContext, ids: ID[], tagIds: ID[]): Promise<MerchantAfterSalesBatchResult[]>;
    /** 解除本店拉黑（§89）：按顾客维度撤销 active 记录 */
    unblacklistAfterSalesCustomer(ctx: RequestContext, customerId: ID): Promise<boolean>;
    /** 本店拉黑顾客列表（§90）：仅 active 记录，按拉黑时间倒序 */
    afterSalesBlacklist(ctx: RequestContext, opts?: {
        skip?: number | null;
        take?: number | null;
    }): Promise<MerchantAfterSalesBlacklistEntry[]>;
    /** 批量指派处理人（§90）：userId 为空=批量取消，逐单返回结果 */
    afterSalesBatchAssign(ctx: RequestContext, ids: ID[], userId: ID | null): Promise<MerchantAfterSalesBatchResult[]>;
    /** 记录指派/转交变更（§92、§99）：写日志失败不阻断指派本身 */
    private recordAssignChange;
    /** 指派历史（§92）：按时间倒序，带双方姓名；§99 起含转交原因 */
    private afterSalesAssignLogs;
    /** 批量内部备注（§92）：上限 50 单，逐单结果；单条售后备注上限 200 条 */
    afterSalesBatchNote(ctx: RequestContext, ids: ID[], content: string): Promise<MerchantAfterSalesBatchResult[]>;
    /** 商品售后统计（§92）：区间内 Top 商品售后单量、退款额与售后率 */
    afterSalesProductReport(ctx: RequestContext, from: string, to: string, limit?: number | null): Promise<MerchantAfterSalesProductRow[]>;
    /** 售后原因分布（§93）：区间内按原因聚合单量/退款，含占比与环比 */
    afterSalesReasonReport(ctx: RequestContext, from: string, to: string, limit?: number | null): Promise<MerchantAfterSalesReasonRow[]>;
    /** 顾客售后档案（§93）：本店维度聚合历史售后、退款与拉黑状态 */
    afterSalesCustomerProfile(ctx: RequestContext, customerId: ID): Promise<MerchantAfterSalesCustomerProfile>;
    /** 售后处理凭证（§93）：门店留存/交接用纯文本凭条 */
    afterSalesPrintSlip(ctx: RequestContext, id: ID): Promise<string>;
    /** 批量打印售后凭证（§94）：多选一次生成多张凭条，单批上限 50，无效单跳过 */
    afterSalesPrintSlips(ctx: RequestContext, ids: ID[]): Promise<string[]>;
    /**
     * 线下退款登记（§94）：商家以现金/转账等方式线下退款后登记，直接置为 Refunded，
     * 不触发支付网关；同时写状态历史与内部备注留痕，并触达顾客。
     */
    afterSalesOfflineRefund(ctx: RequestContext, id: ID, amount: number, method: string, note?: string | null): Promise<MerchantAfterSalesOfflineRefundResult>;
    /** 标记售后风险（§94）：争议/异常单，列表可按风险筛选 */
    afterSalesRiskFlag(ctx: RequestContext, id: ID, reason?: string | null): Promise<MerchantAfterSalesRow>;
    /** 解除售后风险标记（§94） */
    afterSalesRiskClear(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesRow>;
    /** 新增顾客回访记录（§94）：电话/线上沟通留痕，可预约下次跟进 */
    afterSalesAddFollowUp(ctx: RequestContext, id: ID, method: string, result: string, note?: string | null, nextAt?: string | null): Promise<MerchantAfterSalesFollowUpRow[]>;
    /** 回访记录列表（§94，按时间倒序）：表缺失时降级为空 */
    private afterSalesFollowUps;
    /** 风险原因映射（§94）：Key=requestId，仅返回 active=true 的标记 */
    private afterSalesRiskReasons;
    /** SLA 暂停状态映射（§95/§96）：Key=requestId，pausedMs 为已累计暂停毫秒，reason 为当前暂停原因 */
    private afterSalesSlaPauses;
    /** SLA 暂停记录（§96）：按暂停时间倒序；表缺失时降级为空 */
    private afterSalesSlaPauseLogs;
    /** 平台仲裁升级记录（§96）：按时间倒序；表缺失时降级为空 */
    private afterSalesEscalations;
    /** 已升级单映射（§96）：Key=requestId，存在未关闭工单为 true；表缺失时降级为空 */
    private afterSalesEscalatedMap;
    afterSalesExportSelection(ctx: RequestContext, ids: ID[], kind: string): Promise<string>;
    /** 处理人负载（§91）：按处理人聚合未完结单，附超时/临期；userId=0 为未指派 */
    afterSalesAssigneeLoad(ctx: RequestContext): Promise<MerchantAfterSalesAssigneeLoad[]>;
    /** 员工处理绩效（§89）：按操作人统计处理量、完结数与首次操作/完结耗时 */
    afterSalesStaffStats(ctx: RequestContext, from: string, to: string): Promise<MerchantAfterSalesStaffRow[]>;
    /** 售后单存在且属于本店渠道（备注等无状态限制场景复用） */
    private assertRequestInChannel;
    /** 规则变更后重排未执行任务（§86）：按新时限重算到期时间，0 表示关闭则作废 */
    private rescheduleAfterSalesTasks;
    /**
     * 退款重试次数变更立即生效（§87）：
     * 自动重试关闭 → 作废本店待执行的退款重试任务；
     * 否则为 RefundFailed 单补排/复位任务（次数下调到已用次数以下则不再补排）。
     */
    private rescheduleRefundRetryTasks;
    private toTaskRow;
    /** 售后超时任务执行器（§85）：可选依赖，未装售后插件时为空 */
    private afterSalesJobSvc?;
    private getAfterSalesJob;
    /** 金额分 → 元（两位小数），导出用 */
    private yuan;
    /** 校园时间导出格式：YYYY-MM-DD HH:mm:ss（UTC+8） */
    private campusDateTime;
    /** 手机号脱敏：保留前 3 后 4，长度不足时整体打码 */
    private maskPhone;
    private toCsv;
    /**
     * 售后报表（§83）：按校园日（UTC+8）统计区间内创建量、退款单数与金额、当前超时数、逐日趋势。
     * 渠道隔离沿用「订单渠道」口径；退款按 refundedAt 归集，避免跨区间错位。
     */
    afterSalesReport(ctx: RequestContext, from: string, to: string): Promise<MerchantAfterSalesReport>;
    /** 批量参数归一：去重、正整数、单批上限 50 */
    private normalizeBatchIds;
    /** 批量执行：插件批量方法不做渠道校验，必须先按本渠道过滤，防跨店操作 */
    private afterSalesBatch;
    /** 校园日（UTC+8）起止：起含、止不含（to 的次日 00:00） */
    private campusDayStart;
    private campusDayEnd;
    /** 商家协商留言（§82）：仅待处理/顾客申诉单可回复，已退款、已驳回、已关闭一律只读 */
    afterSalesReply(ctx: RequestContext, id: ID, content: string, images?: string[] | null): Promise<MerchantAfterSalesMessage>;
    /** 售后处理统计（§81）：入口红点 + 超时 + 今日处理量/退款额（今日按校园日 UTC+8 切分） */
    afterSalesStats(ctx: RequestContext): Promise<MerchantAfterSalesStats>;
    /** 售后工作台摘要（§88）：一次返回各待办入口计数与最老待处理时长 */
    afterSalesWorkbench(ctx: RequestContext): Promise<MerchantAfterSalesWorkbench>;
    /** 申请时间区间：纯日期按校园日（UTC+8）切分，to 含当天；非法格式直接拒绝 */
    private afterSalesRange;
    /** 售后操作审计留痕（§100）：统一记录处理人/动作/详情，失败不阻断业务操作 */
    private auditAfterSales;
    /** 售后操作审计检索（§100）：按时间/动作/处理人筛选，带订单号 */
    afterSalesAuditLogs(ctx: RequestContext, opts?: {
        from?: string | null;
        to?: string | null;
        action?: string | null;
        actorUserId?: ID | null;
        take?: number | null;
        skip?: number | null;
    }): Promise<MerchantAfterSalesAuditRow[]>;
    /** 售后操作审计导出（§100）：CSV，最多 5000 条 */
    afterSalesAuditExport(ctx: RequestContext, opts?: {
        from?: string | null;
        to?: string | null;
        action?: string | null;
        actorUserId?: ID | null;
    }): Promise<string>;
    /** 审计查询（§100）：统一拼条件，导出与列表共用 */
    private queryAuditRows;
    private toAuditRow;
    /** 值班表（§100）：本店全部排班，带值班人姓名 */
    afterSalesDutyRoster(ctx: RequestContext): Promise<MerchantAfterSalesDutyEntry[]>;
    /** 整体替换值班表（§100）：校验值班人均属本店，事务内先删后插 */
    setAfterSalesDutyRoster(ctx: RequestContext, entries: unknown): Promise<MerchantAfterSalesDutyEntry[]>;
    /** 补偿挽留方案列表（§100） */
    afterSalesCompensationPlans(ctx: RequestContext): Promise<MerchantAfterSalesCompensationPlan[]>;
    /** 保存补偿方案（§100）：id 为空新建，否则更新；退款金额单位分 */
    saveAfterSalesCompensationPlan(ctx: RequestContext, input: {
        id?: ID | null;
        name: string;
        refundAmount: number;
        couponTemplateId?: string | null;
        note?: string | null;
        enabled?: boolean | null;
    }): Promise<MerchantAfterSalesCompensationPlan[]>;
    /** 删除补偿方案（§100） */
    deleteAfterSalesCompensationPlan(ctx: RequestContext, id: ID): Promise<MerchantAfterSalesCompensationPlan[]>;
    private toCompensationPlan;
    /**
     * 一键发放补偿挽留（§100）：部分退款（可 0）+ 优惠券补偿，随后关闭售后单并通知顾客。
     * 退款失败直接抛错（不吞金额），发券失败降级为仅退款并回写原因。
     */
    afterSalesApplyCompensation(ctx: RequestContext, id: ID, planId: ID): Promise<MerchantAfterSalesCompensationResult>;
    /** 渠道售后处理时限（小时）：afterSalesTimeoutHours，未配置按售后插件默认 48 */
    private afterSalesTimeoutHours;
    /**
     * 按当前营业时间/处理时限重算本渠道未完结售后单的 SLA 截止时间（§99）。
     * 规则或门店营业时间变更后立即生效，无需等定时任务下一轮。
     */
    private recomputeSlaDeadlines;
    /** 单条售后单的 SLA 截止时间即时重算（§99）：SLA 恢复/暂停后调用 */
    private refreshSlaDeadline;
    /** 驳回售后（§81）：理由必填（顾客在 C 端可见），仅 Pending 可驳回 */
    afterSalesReject(ctx: RequestContext, id: ID, reason: string): Promise<MerchantAfterSalesRow>;
    /** 分流规则行映射（§98）：DB 原始行 → 接口结构 */
    private toAutoRule;
    /** 售后单必须属于当前店铺，且状态在允许集合内（空集合=不校验状态） */
    private assertChannelAfterSales;
    private afterSalesOne;
    /** 协商留言列表（正序，最多 100 条）：插件表缺失时降级为空，不影响详情可用 */
    private afterSalesMessageRows;
    /** 状态流转时间线（正序，最多 50 条）：历史表缺失时降级为空；§88 补充处理人 */
    private afterSalesHistoryRows;
    /** 每单最新留言发送方（批量）：用于 unread 标记（最新为 customer 即待商家回复） */
    private afterSalesLastSender;
    /** 订单商品行（售后详情）：商品名优先取变体中文翻译，缺失回落商品翻译 */
    private afterSalesOrderItems;
    /** 协商留言条数（批量）：插件表缺失时降级为 0，不影响清单可用 */
    private afterSalesMessageCounts;
    private toAfterSalesRow;
    /** 一键沽清：商品列表（本渠道），带售罄标记与规格数（搜索按名称模糊） */
    products(ctx: RequestContext, search?: string, skip?: number, take?: number): Promise<{
        items: any;
        total: number;
    }>;
    /** 沽清开关：售罄仍展示、不可加购；下单前置闸门二次校验 */
    setProductSoldOut(ctx: RequestContext, productId: ID, soldOut: boolean): Promise<{
        ok: boolean;
        soldOut: boolean;
    }>;
    /** 全店批量沽清 / 批量恢复：仅本渠道未删除商品，返回实际影响条数（打烊后一键恢复用） */
    setAllProductsSoldOut(ctx: RequestContext, soldOut: boolean): Promise<{
        ok: boolean;
        soldOut: boolean;
        count: number;
    }>;
    /** 清除全店沽清批次登记（传 productId 只清该商品） */
    clearSoldOutBatch(ctx: RequestContext, opts: {
        productId?: number;
    }): Promise<void>;
    /** 沽清自动恢复开关 + 待恢复件数（后台开关与文案用）；开关列由 §66 迁移补，不在 customFields 声明（避免 schema sync 并发加列失败） */
    getSoldOutAutoRestore(ctx: RequestContext): Promise<{
        enabled: boolean;
        pending: number;
    }>;
    setSoldOutAutoRestore(ctx: RequestContext, enabled: boolean): Promise<{
        enabled: boolean;
        pending: number;
    }>;
    private countSoldOutBatch;
    /** 商品级打包费（分/件）：null 清除回落店铺配置；仅本渠道商品可改 */
    setProductPackingFee(ctx: RequestContext, productId: ID, packingFee: number | null): Promise<{
        ok: boolean;
        packingFee: number | null;
    }>;
    /** 每日限量 / 每人限购（§68）：null 或 0 = 不限；每人限购不得大于每日限量 */
    setProductLimit(ctx: RequestContext, productId: ID, dailyLimit: number | null, perUserLimit: number | null): Promise<{
        ok: boolean;
        dailyLimit: number | null;
        perUserLimit: number | null;
        soldToday: number;
        remaining: number | null;
    }>;
    /** 商品加料组（P1-2）：空数组=清除；清洗后再序列化，脏数据不入库 */
    setProductAddonGroups(ctx: RequestContext, productId: ID, rawGroups: unknown): Promise<{
        ok: boolean;
        addonGroups: string | null;
    }>;
    /** 商品套餐内容（P1-2）：传 null/空 items=清除（非套餐商品） */
    setProductCombo(ctx: RequestContext, productId: ID, rawCombo: unknown): Promise<{
        ok: boolean;
        combo: string | null;
    }>;
    /** 商品必须属于当前店铺渠道（越权防护：商家只能改本店商品） */
    private assertProductInChannel;
    private assertAnyChannelOrder;
    private assertChannelOrder;
    private assertChannelOrderState;
    /** 组装商家视图 DTO：楼栋名批量查、骑手名批量查，不外泄 admin 内部字段 */
    private toDto;
}
/** 催单是否仍未处理（§78）：顾客置了 urged 且「已知晓」时间早于最近一次催单（顾客再催会重新变为待处理） */
export declare function isUrgePending(urged: unknown, urgedAt: Date | null, ackedAt: Date | null): boolean;
