import { ModuleRef } from '@nestjs/core';
import { Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { CampusDedupeService } from './campus-dedupe.service';
import { CapacityService } from './capacity.service';
import { CampusNotifyService } from './campus-notify.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { SlotLockService } from './slot-lock.service';
/** 仍在履约链路上的大厅状态（取消脱厅/回厅/条件状态迁移共用）。
 * 终态（delivered/cancelled/no_rider_final/exception_final）不在其中，任何写入都不应把终态单改回流转态。 */
export declare const ACTIVE_HALL_STATUSES: string[];
/**
 * 入厅服务：跑腿单（orderKind='errand'）或路线 R1/R3 的订单在**支付成功后**自动进入抢单大厅。
 * 含预约时段锁位（T0 前置）：锁位失败标 campusCause='slot_full'，靠调度告警人工跟进。
 * 支付闸门：由插件订阅 PaymentStateTransitionEvent（Authorized/Settled）触发，未支付订单不进大厅、不可被抢。
 */
export declare class HallService {
    private connection;
    private slotLock;
    private moduleRef;
    private capacity;
    private feishu?;
    private notify?;
    /** M4 跨实例限频（多实例部署时同单重发不串号）；未注入退回进程内 Map */
    private dedupe?;
    /** 预约单放量窗口：scheduledFor 前 30min 才进入商家确认/抢单大厅（plan 3.1） */
    static readonly SCHEDULE_RELEASE_MIN = 30;
    /** R5 交接码重发限流：同单 10 分钟一次（M4 经 dedupe 跨实例；未注入时退回进程内 Map） */
    static readonly HANDOVER_RESEND_INTERVAL_MS: number;
    private handoverResendAt;
    constructor(connection: TransactionalConnection, slotLock: SlotLockService, moduleRef: ModuleRef, capacity: CapacityService, feishu?: FeishuNotifyService | undefined, notify?: CampusNotifyService | undefined, 
    /** M4 跨实例限频（多实例部署时同单重发不串号）；未注入退回进程内 Map */
    dedupe?: CampusDedupeService | undefined);
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private get injector();
    /** 收货楼栋坐标（用于挑最近交接点）；楼栋未配坐标返回 null */
    private resolveDestPoint;
    /** 预约单时段文本（'2026-10-06 11:00-11:30' 或 '11:00-11:30'）解析时长；无法解析返回 null。
     *  支持跨天时段（如 '23:30-00:10'）：结束时间不大于开始时间时视为次日。 */
    static slotSpanMinutes(text: string): number | null;
    /**
     * 承诺送达时间（支付时固化，超时赔付判定基准）：
     * - 预约单：时段结束时间（文本解析失败退回「时段开始 + 配送时长」）
     * - 即时单：支付时间 + 店铺配送时长（未配置按 40min）
     */
    private resolvePromise;
    onOrderPlaced(ctx: RequestContext, orderInput: Order): Promise<void>;
    /** 预约单放量（调度 job 调用，plan 3.1）：按路由/快照分流。
     * 放量即写 hallEnteredAt 作为「商家/运力计时锚点」：预约单 createdAt 可能早于放量数小时甚至数天，
     * 若下游超时兜底沿用 createdAt，一放量就会被判定超时（R1 直接转自营、R2 直接进大厅、跳过商家确认）。
     * 条件写（仅 scheduled 态）：与用户取消并发时不把已取消单复活。返回是否真正放量。 */
    releaseScheduled(ctx: RequestContext, order: Order, cfg: CampusFulfillmentConfig | null): Promise<boolean>;
    /** 放量目标态（put 与调度 job 共用；job 用它在内存里同步订单快照，避免同轮二次误判） */
    static releaseTarget(cf: any, cfg: CampusFulfillmentConfig | null): string;
    /** 第一段交接完成：订单进校园抢单大厅（R1/R2 接力上楼）。
     * 条件写（CAS）：仅当 hallStatus 仍在 from 集合内（本段确实在途）才入厅并生成交接码，
     * 否则说明订单已被取消/已入厅（并发回调），返回空串由调用方决定是否报错。
     * extra 承载调用方需要同语句落库的附加字段（如 handoverAt/thirdPartyState），避免两步写。
     * 同时生成 4 位交接码（第二段骑手取货时校验，防丢餐扯皮），返回码值供调用方通知用户。 */
    enterHallForHandover(ctx: RequestContext, orderId: number, cause: string, from?: string[], extra?: Record<string, unknown>): Promise<string>;
    /**
     * R5 交接码重发（飞书指令 / 顾客侧共用）。
     * 条件写（CAS）：仅当 hallStatus='open' 且订单未取消才更新，避免把已完成/已脱厅订单的码改掉。
     * 限流：同单 10 分钟一次；返回新码（调用方自行决定是否展示，日志不落明文）。
     */
    resendHandoverCode(ctx: RequestContext, orderId: number): Promise<string>;
    /** 同单 10min 限流：dedupe 走原子计数（跨实例），未注入退回进程内 Map */
    private claimResendWindow;
    /** R5 顾客侧重发：先校验订单归属当前登录顾客，再复用同一条件写。 */
    resendHandoverCodeForCustomer(ctx: RequestContext, orderId: number): Promise<string>;
    /** 回大厅：清骑手指派字段，hallStatus 复位 open（拒单/超时改派共用）。
     *  条件写：仅活跃流转态可回厅，已取消/已终态单不被复活；extra 与复位字段同语句落库（后台强制回厅留痕）。
     *  返回是否命中。 */
    backToHall(ctx: RequestContext, orderId: number, extra?: Record<string, unknown>): Promise<boolean>;
    /**
     * 条件状态迁移（CAS）：仅当 hallStatus 仍在 from 集合内、且订单未被取消时才写入 patch，返回 affected>0。
     * 调度扫描/商家操作都是「先读后写」，若期间用户取消并脱厅（hallStatus=cancelled），
     * 无条件 update 会把已退款单改回 open/pending_merchant 重新进入大厅被抢。
     * 额外加 state != 'Cancelled'：取消事件异步写完 hallStatus 前仍有窗口，仅凭 hallStatus 条件不足。
     * 用单条 UPDATE + 条件把「校验与写入」合并成一个原子动作。
     */
    transitionFrom(_ctx: RequestContext, orderId: number, from: string[], patch: Record<string, unknown>): Promise<boolean>;
    /** 取消脱厅（3.3 冒烟实测缺陷）：订单取消终态时清 hallStatus，使其退出大厅/打包扫描/整组抢单/调度台。
     * 单条条件写：仅活跃流转态可脱厅——先读后写会被 T4 mark() 写 no_rider_final 的竞态覆盖；
     * grabbed 单连带清骑手指派字段（CASE 表达式读同一语句的旧值）。
     * refund_failed 虽已退出自动履约，取消时同样要脱厅：留在 refund_failed 会被退款重试任务重新捞起。 */
    exitHall(_ctx: RequestContext, order: Order): Promise<void>;
    /** 通用订单更新（T4 退款终态标记等复用） */
    updateOrder(ctx: RequestContext, orderId: number, patch: any): Promise<import("typeorm").UpdateResult>;
    /** T0: 新单入厅即提醒在线骑手（订阅消息），失败只记日志不阻塞入厅。
     * 模板 ID 复用渠道 orderShippedTemplateId（wechat 插件未定义 campus 专用模板字段），
     * 未配置则跳过；逐骑手发送，单个失败不影响其余骑手。 */
    private notifyRiders;
}
