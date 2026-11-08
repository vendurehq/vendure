import { ID, Injector, ListQueryBuilder, ListQueryOptions, OrderService, PaginatedList, PaymentService, RequestContext, TransactionalConnection } from '@vendure/core';
import { OrderPaymentSchedule } from './order-payment-schedule.entity';
import { OrderScheduleItem } from './order-schedule-item.entity';
import { DepositRule, ItemKind, ScheduleStatus, ScheduleTrigger } from './schedule-config';
export interface CreateScheduleItemInput {
    seq: number;
    kind: ItemKind;
    amount: number;
    allowCod?: boolean;
    trigger: ScheduleTrigger;
    graceHours?: number;
    lateFeeRule?: {
        dailyRate: number;
    } | null;
}
export interface CreateScheduleInput {
    orderId: ID;
    scenario: 'presale' | 'installment' | 'rental';
    deliveryGate: 'all_paid' | 'first_period' | 'deposit_paid';
    depositRule?: DepositRule | null;
    agreementVersion: string;
    shipDeadline?: Date | null;
    /** 场景扩展快照（租赁买断等），原样落库到实体 meta 列 */
    meta?: Record<string, unknown> | null;
    items: CreateScheduleItemInput[];
}
export interface ScheduleWithItems {
    schedule: OrderPaymentSchedule;
    items: OrderScheduleItem[];
}
export declare class PaymentScheduleService {
    private connection;
    private listQueryBuilder;
    private orderService;
    private paymentService;
    constructor(connection: TransactionalConnection, listQueryBuilder: ListQueryBuilder, orderService: OrderService, paymentService: PaymentService);
    init(_injector: Injector): void;
    private scheduleRepo;
    private itemRepo;
    private findItems;
    private orderWithPayments;
    private assertOrderOwner;
    createSchedule(ctx: RequestContext, input: CreateScheduleInput): Promise<OrderPaymentSchedule>;
    /** 追加期次（租赁买断场景；调度须为 rental 且尚无买断项） */
    addScheduleItem(ctx: RequestContext, scheduleId: number, input: {
        kind: ItemKind;
        amount: number;
        trigger?: ScheduleTrigger;
    }): Promise<ScheduleWithItems>;
    getScheduleForOrder(ctx: RequestContext, orderId: ID, opts?: {
        requireOwner?: boolean;
    }): Promise<ScheduleWithItems | null>;
    getScheduleById(ctx: RequestContext, scheduleId: number | null, opts?: {
        requireOwner?: boolean;
    }): Promise<ScheduleWithItems | null>;
    listSchedules(ctx: RequestContext, options?: ListQueryOptions<OrderPaymentSchedule>): Promise<PaginatedList<OrderPaymentSchedule>>;
    /** GraphQL 呈现（滞纳金/已付统计现算，不落库） */
    presentSchedule(withItems: ScheduleWithItems, now?: Date): {
        items: {
            trigger: ScheduleTrigger;
            paidAmount: number;
            lateFeeAccrued: number;
            scheduleId: number;
            seq: number;
            kind: ItemKind;
            amount: number;
            allowCod: boolean;
            dueAt?: Date;
            graceHours: number;
            lateFeeRule: import("./schedule-config").LateFeeRule | null;
            status: import("./schedule-config").ItemStatus;
            paidAt?: Date;
            paymentId: number | null;
            groupBuyActivityId: number | null;
            id: ID;
            createdAt: Date;
            updatedAt: Date;
        }[];
        paidTotal: number;
        totalAmount: number;
        orderId: number;
        channelId: number;
        scenario: import("./schedule-config").ScheduleScenario;
        deliveryGate: import("./schedule-config").DeliveryGate;
        depositRule: DepositRule | null;
        agreementVersion: string;
        status: ScheduleStatus;
        breachType: import("./schedule-config").ScheduleBreachType | null;
        shipDeadline?: Date;
        meta: Record<string, unknown> | null;
        channels: import("@vendure/core").Channel[];
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    };
    /** Admin 列表批量取期次（供 resolver 组装 present） */
    findItemsForPresent(ctx: RequestContext, scheduleId: number): Promise<OrderScheduleItem[]>;
    /**
     * 付任意期次（在线/COD 均经此）。
     * Settled → item paid + 推进订单状态；Authorized（COD handler）→ item 留待 confirmCodReceived。
     */
    paySchedulePeriod(ctx: RequestContext, orderId: ID, seq: number, method: string): Promise<ScheduleWithItems>;
    /** locked 期次在支付时刻补偿触发（补偿扫描任务最长 1 分钟延迟）：date 到点 / interval 到点 */
    private unlockByTrigger;
    private afterItemPaymentRecorded;
    /** COD 环收尾：签收后管理员确认 → settle 授权支付 → item paid → 可能 PaymentSettled */
    confirmCodReceived(ctx: RequestContext, orderId: ID): Promise<ScheduleWithItems>;
    /**
     * 薄壳桥专用：预售尾款窗口已开（窗口校验由 pre-sale-plugin 负责）→ 强制解锁 locked 尾款期。
     * 属 legacy 兼容通道（旧 API 语义：到货+窗口 ⇒ 尾款可付），优先级高于期次 trigger。
     */
    unlockTailForOrder(ctx: RequestContext, orderId: ID): Promise<void>;
    /**
     * 买家主动取消：
     * - legal_deposit：须 confirmForfeit=true，定金没收（forfeited），其余已付期次全退
     * - earnest：按 earnestRefundPolicy 退（默认全额）
     * - 其他（首付/押金语义）：已付期次全退
     * 未支付期次 → waived；调度 → cancelled；订单 → Cancelled（库存经各插件 Cancelled 订阅释放）。
     */
    cancelSchedule(ctx: RequestContext, orderId: ID, confirmForfeit: boolean): Promise<ScheduleWithItems>;
    private channelScheduleIds;
    /** 单条计划是否属于指定渠道（默认取当前请求渠道；事件路径须显式传入活动所属渠道） */
    private isScheduleInChannel;
    /** 触发扫描：locked → payable（date 到点 / interval 到点 / group_buy 活动完成或失败） */
    processTriggers(ctx: RequestContext, now?: Date): Promise<{
        activated: number;
        failedSchedules: number;
    }>;
    /** group_buy 触发器：软依赖团购活动状态（completed→解锁；expired/过期→按不成团处理） */
    private handleGroupBuyTrigger;
    private findGroupBuyActivity;
    /** 活动所属渠道 id 列表（事件路径没有可靠的 ctx.channelId，以活动自身关联为准） */
    private activityChannelIds;
    /** 团购不成团：已付期次全额原路退，未付 → waived，调度 breached(group_buy_failed)，订单取消 */
    failSchedulesForGroupBuy(ctx: RequestContext, activityId: number, now?: Date): Promise<number>;
    /** 事件入口：团购成团（事件与扫描双通道，事件先行即时解锁） */
    handleGroupBuyCompleted(ctx: RequestContext, activityId: number): Promise<number>;
    /** 事件入口：团购失败 */
    handleGroupBuyFailed(ctx: RequestContext, activityId: number): Promise<number>;
    /** 逾期扫描：payable 超 dueAt+graceHours → overdue + 违约动作（仅作用于本次转 overdue 期） */
    processOverdue(ctx: RequestContext, now?: Date): Promise<{
        overdue: number;
        cancelledOrders: number;
    }>;
    /** 违约矩阵（设计 §7）——只对逾期期执行 */
    private applyBreachAction;
    /** 发货超期扫描：超过发货承诺未发货 → 标记 seller_breach 待管理员确认 */
    processShipDeadlines(ctx: RequestContext, now?: Date): Promise<number>;
    /**
     * 卖家违约确认（管理员）：
     * - legal_deposit 定金：双倍返还（本金 refund + 等额赔偿 refund，两笔留痕）
     * - 其余已付期次：全额退
     * 未付期次 → waived；调度 → cancelled；订单取消。
     */
    confirmSellerBreach(ctx: RequestContext, scheduleId: number): Promise<ScheduleWithItems>;
    /** 手动开启尾款窗口（manual/group_buy 期次 → payable） */
    openTailWindow(ctx: RequestContext, scheduleId: number): Promise<ScheduleWithItems>;
    /** 租赁还物退押（管理员）：押金期已付 → 全额原路退 → refunded */
    releaseDepositForRental(ctx: RequestContext, orderId: ID): Promise<ScheduleWithItems>;
    handleOrderCancelled(ctx: RequestContext, orderId: ID): Promise<void>;
    private readOrderScheduleId;
    private notifyTailOpened;
    private transition;
    private cancelOrderSafe;
    /**
     * 退款（能力闸门 + 立即结算）。原先只 createRefund 不 settleRefund，退款单永远停在 Pending：
     * - 货到付款等无原路退能力的方式：不建待退款单，改落人工现金退还工单（含订单号/金额/原因）；
     * - 有退款能力：建单后立即 settleRefund 真实打款，并回读终态；
     *   结算抛错或回读未达 Settled → 退款单置 Failed（保留审计痕迹）并告警，返回 false 交上层人工处理。
     */
    private refundPayment;
    /** 支付方式是否具备原路退款能力（按处理器 handler code 判定；查不到方式时按具备处理，保持原行为） */
    private paymentSupportsRefund;
    /** settleRefund 打款 + 回读终态（与 campus settleRefundOrMarkFailed 同口径） */
    private settleRefundAndVerify;
    private markRefundFailed;
    /** 无退款能力方式（货到付款）：落人工现金退还工单（软依赖 campus SupportService，未安装时只告警） */
    private createManualCashRefundTask;
    /** 幂等退款：已 Settled 退款合计 + 本次 > 支付额 时拒绝（防团购与调度双通道重复退款） */
    private refundPaymentOnce;
    /**
     * 双倍返还的「等额赔偿」笔：本金退完后 createRefund 的可退余额为 0（Vendure 对超额退款
     * 恒返 RefundAmountError），赔偿属平台法定赔付留痕（设计 §7：本金 refund + 等额赔偿 refund），
     * 直接落一条 Settled Refund 记录，不经网关、不受可退余额约束。
     */
    private recordCompensationRefund;
}
