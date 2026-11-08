import { OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { CapacityService } from './capacity.service';
import { CampusDedupeService } from './campus-dedupe.service';
import { CampusNotifyService } from './campus-notify.service';
import { CompensationTaskService } from './compensation-task.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { HallGrabService } from './hall-grab.service';
import { HallService } from './hall.service';
import { ThirdPartyDeliveryService } from './third-party-delivery.service';
import { RiderCreditService } from './rider-credit.service';
import { SupportService } from './support.service';
export declare class DispatchJobService implements OnApplicationShutdown {
    private connection;
    private grab;
    private hall;
    private capacity;
    private credit;
    private moduleRef;
    private thirdParty?;
    private feishu?;
    private notify?;
    private compensation?;
    /** R7：外部运单异常自动建工单（同插件服务，平台 ctx 可用） */
    private support?;
    /** M4 跨实例去重/计数（多实例下告警限频与取消失败计数共享）；未注入退回进程内 Map */
    private dedupe?;
    /** 统一兜底调度器（单飞 / unref / 优雅关闭由 PeriodicFallback 统一保证） */
    private fallback;
    private running;
    private orderSvc?;
    private couponSvc?;
    /** 超时赔付缺配置告警限频（避免每分钟刷日志） */
    private compensationWarnAt;
    /** 外部运单取消失败连续轮次（进程内，仅用于告警升级；不落库，多实例各自计数可接受） */
    private externalCancelFails;
    /** 轨迹清理上次执行时间（跨渠道全局，每 6h 一次） */
    private lastLocationCleanupAt;
    /** 外部异常告警去重 TTL（进程内幂等，pm2 单实例足够；多实例需换 Redis/DB） */
    private static readonly EXTERNAL_EXCEPTION_ALERT_TTL_MS;
    /** §6 外部运单异常态告警去重 key（单号:外部运单号）→ 首次告警时间，状态恢复后移除 */
    private readonly externalExceptionAlertedAt;
    /**
     * 扫描分桶（P2 积压策略）：状态互斥、各自限额，保证任何单一状态爆量都不会挤掉其它状态的兜底。
     * - open：量最大，T2 强派 / T4 退款；
     * - scheduled：预约单必须独立配额，否则永远排在活单之后拿不到放量；
     * - inflight：已接单/待商家/外部快递/自营，负责取货超时、异常 SLA、外部对账。
     */
    private static readonly SCAN_BUCKETS;
    constructor(connection: TransactionalConnection, grab: HallGrabService, hall: HallService, capacity: CapacityService, credit: RiderCreditService, moduleRef: ModuleRef, thirdParty?: ThirdPartyDeliveryService | undefined, feishu?: FeishuNotifyService | undefined, notify?: CampusNotifyService | undefined, compensation?: CompensationTaskService | undefined, 
    /** R7：外部运单异常自动建工单（同插件服务，平台 ctx 可用） */
    support?: SupportService | undefined, 
    /** M4 跨实例去重/计数（多实例下告警限频与取消失败计数共享）；未注入退回进程内 Map */
    dedupe?: CampusDedupeService | undefined);
    /** 外部异常告警去重：按「单号:运单号」保留 24h（DB 去重表跨实例；无 dedupe 时退回进程内 Map） */
    private shouldAlertExternalException;
    /** 取消失败计数 +1（多实例共享；返回连续失败轮次） */
    private bumpCancelFail;
    /** 取消失败升级告警限频（30min；多实例共享） */
    private shouldAlertCancelFail;
    /** R7：外部运单异常建工单（幂等由 dedupeKey 保证）；建单失败不影响告警主流程 */
    private createExceptionTicket;
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private get injector();
    start(intervalMs?: number): void;
    onApplicationShutdown(): void;
    private tick;
    /** 骑手轨迹过期清理（P8-4）：保留 30 天，避免位置表无限增长。失败只告警不影响调度。 */
    private cleanupRiderLocations;
    /**
     * 按渠道加扫描锁：多实例幂等（pm2 多进程/多副本时同一渠道同一轮只允许一个实例扫描），
     * 同时把渠道间故障隔离——单渠道扫描抛错不再中断其余渠道（上一版全局锁整体串行，渠道多时
     * 一轮超 60s 会被 running 标志跳过，造成积压）。
     */
    private scanChannelWithLock;
    private ctxForChannel;
    /**
     * 扫描当前 ctx 渠道：
     * 1) assigned 超 15min 未取货 → 回大厅 + 骑手扣分
     * 2) open 超 autoAssignMinutes → 强派最佳在线骑手（T2）
     * （T4 退款扫描在 Task 8 追加到此方法）
     */
    scan(ctx: RequestContext): Promise<void>;
    /**
     * 异常上报超时升级（改人工介入）：异常单超 SLA 未处置时**不再自动回大厅**，
     * 保持异常标记与状态不变，只发升级告警进人工介入队列（调度墙 exception 列表），
     * 避免「餐可能仍在骑手手上」被系统自动重派造成丢餐。
     * 告警 dedupe 按订单 code 收敛，重复轮询不会重复刷屏。
     */
    private sweepExceptionTimeout;
    /**
     * 骑手已取餐（in_progress）超 SLA 兜底（改人工介入）：已取餐意味着餐在骑手手上，
     * 15 分钟回收与 2×SLA 自动转异常一律禁用——只告警，状态全程不变，等运营人工介入。
     * 时钟只认 pickedUpAt（缺失退回 assignedAt），缺失时跳过，绝不回退 createdAt。
     */
    private sweepRiderInProgress;
    /**
     * 路线超时兜底：
     * 1) R1 pending_merchant 超 merchantAcceptMinutes → 转自营快递池（owned_pool，等人接单）
     * 2) merchant_delivering 超 merchantAutoOpenMinutes → 回抢单大厅（传信者到档口取餐）
     * 3) pending_dispatch 超 externalPushTimeoutMinutes → 回抢单大厅
     * 4) third_party 超 externalFallbackMinutes → 取消外部快递；R2 回待推送换一家，R3 回大厅
     *    （平台已接单/取货不按该阈值取消，仅 3× 硬上限兜底）
     * 5) owned_pool 超 merchantAutoOpenMinutes 无人接 → 回大厅
     * 6) owned_dispatched 超 merchantAutoOpenMinutes 未送达交接点 → 回大厅并清空骑手
     */
    private sweepRouteTimeouts;
    /**
     * 超时赔付（P0）：回扫窗口内（默认近 24h，可配）已送达单，实际送达超出承诺时间 + 宽限 → 自动发定向券。
     * 幂等：timeoutCompensatedAt 作闸，已赔单不再扫；发券失败不落痕，下一轮重试。
     * 归因（粗判）：无骑手承接 = platform；接单前耗时 > 骑手在途 = merchant，否则 rider。
     */
    private sweepTimeoutCompensation;
    /**
     * 订单创建时间（绝对毫秒）。
     * order.createdAt 是 timestamp + DB DEFAULT now()，库里存 UTC 墙钟，必须还原；
     * customFields 里的各类锚点（hallEnteredAt/assignedAt/deliveredAt 等）是 timestamptz，可直接用。
     */
    private createdMs;
    /**
     * 入厅计时锚（绝对毫秒）：hallEnteredAt 是 timestamptz，直接用；
     * 历史/外部写入缺锚时回退 order.createdAt（DB now() 的 UTC 墙钟，需还原）。
     */
    private enteredMs;
    /** 超时归因粗判：无骑手承接=platform；接单前耗时更长=merchant，否则=rider */
    private timeoutAttribution;
    /** 即时单（无 deliverySlotId）打包时间窗：入厅时间差 ≤10min 视为顺路 */
    private static readonly ROUTE_IMM_WINDOW_MIN;
    /**
     * T1.5 多单顺路打包（plan 3.3）：同渠道 hallStatus='open' 的 R1/R3 配送单
     * （errand 跑腿单性质不同不打包）按「同楼栋 + 同时段」分桶：
     * - 有 deliverySlotId：slot 相等即同时段；
     * - 即时单：按 hallEnteredAt 聚类，相邻时间差 ≤ ROUTE_IMM_WINDOW_MIN 分钟归一批。
     * 每批 ≥2 单写同一 routeGroupId（批内已有组 id 则复用，保持组稳定不抖动）。
     * 组 id 仅用于整组抢单与展示聚合，不严格维护成员一致性——子单被抢/回厅/退款后
     * 自然脱组（回厅清指派字段，成员过滤以 hallStatus='open' 为准）。
     */
    private packRoutes;
    /** 订单渠道匹配：channels 关联未加载（无 scalar channelId 可比对）时视为匹配，
     * grabByRider 事务内二次校验 hallStatus 保证幂等，跨渠道重复尝试无害。 */
    private orderInChannel;
    /** T4 惰性服务解析（job 定时器首跳早于完整依赖可用，首次退款时才初始化） */
    private services;
    /** 补偿券服务：coupon-plugin 为可选依赖，动态 require + Injector 解析，
     * 未安装/未启用/解析失败一律返回 null（跳过发券，不阻断退款主流程）。 */
    private tryGetCouponService;
    /**
     * T4: open 超 autoRefundMinutes 无人接单 → 全额原路退款 + Cancelled + no_rider 对账标记 + 定向补偿券。
     * 本 fork 无 core RefundService，退款走 OrderService.refundOrder/settleRefund（与 after-sales 插件同源）。
     * 失败降级：同样写 campusCause='no_rider' + hallStatus='no_rider_final' 留人工，Logger 留痕，不抛出。
     */
    private refundNoRider;
}
