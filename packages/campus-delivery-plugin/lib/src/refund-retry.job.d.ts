import { OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { RequestContextService, TransactionalConnection } from '@vendure/core';
import { CampusDedupeService } from './campus-dedupe.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { SupportService } from './support.service';
/**
 * A9：refund_failed 从「退出自动链路、只能人工认领」改为可靠重试。
 *
 * 次数与退避依据：
 * - 最多 4 次（首次 + 3 次重试）：支付网关的瞬时故障（超时/网络抖动/对端限流）通常几分钟内恢复，
 *   4 次足以覆盖；再多的重复失败基本是确定性失败（如货到付款单、授权态不可退），
 *   继续自动重试只会反复打网关并推迟人工介入。
 * - 退避 2 / 10 / 30 分钟：首轮立即补试，随后逐级拉长（总窗口约 42 分钟），
 *   避免对同一网关密集重试，同时保证在运营一个班次内升级到人工。
 *
 * 幂等保证（任何一次重试都不会重复退款）：
 * 1. 复用订单级退款咨询锁 campus:refund:<id>，与商家拒单/T4/异常处置/改址退款互斥；
 * 2. 锁内复查 hallStatus 仍为 refund_failed，否则跳过（人工已认领/已改派）；
 * 3. 每张支付单按「支付金额 - 已退总额（排除 Failed）」计算余额，余额为 0 不再退；
 * 4. 崩溃遗留的 Pending 退款先结算，结算失败置 Failed 再重算余额（避免 Pending 被算作已退而静默少退）；
 * 5. 退款/取消/落终态在一个锁内完成，任何一步失败都保持 refund_failed 等下次重试。
 *
 * 存量隔离：首次运行把「安装时间」写入 campus_dedupe_key，扫描只处理 updatedAt >= 安装时间的单。
 * 这样线上已存在的 refund_failed（如订单 467）不会被自动触发退款，需人工确认后再处置。
 * 若该单被人工重试并再次失败，updatedAt 会刷新到安装时间之后，之后才纳入自动重试。
 *
 * 耗尽后：飞书告警 + 生成系统工单（人工待办），附订单号、应付/待退金额、失败原因、已尝试次数。
 */
export declare const REFUND_RETRY_MAX_ATTEMPTS = 4;
/** 第 1/2/3 次失败后的等待分钟数；第 4 次失败即升级人工 */
export declare const REFUND_RETRY_BACKOFF_MINUTES: number[];
/** 尝试次数/失败原因保留 7 天（足够覆盖人工处置周期；订单离开 refund_failed 后即清理） */
export declare const RETRY_STATE_TTL_MS: number;
export interface RefundRetryRunResult {
    done: number;
    retried: number;
    escalated: number;
    skipped: number;
}
export declare class RefundRetryJob implements OnApplicationShutdown {
    private readonly connection;
    private readonly dedupe;
    private readonly feishu;
    private readonly support;
    private readonly requestContextService;
    private readonly moduleRef;
    private fallback;
    /** 单测注入点：替换 OrderService（避免构造整个 Vendure 容器） */
    orderSvcOverride: Pick<any, 'refundOrder' | 'settleRefund' | 'cancelOrder'> | null;
    /** 单测注入点：固定存量隔离时间 */
    cutoffOverride: Date | null;
    constructor(connection: TransactionalConnection, dedupe: CampusDedupeService, feishu: FeishuNotifyService, support: SupportService, requestContextService: RequestContextService, moduleRef: ModuleRef);
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项，直接注入会导致插件启动失败） */
    private get injector();
    start(intervalMs?: number): void;
    onApplicationShutdown(): void;
    /** 手动触发一轮（运维/单测） */
    trigger(): Promise<void>;
    runOnce(): Promise<RefundRetryRunResult>;
    /** 锁内执行；返回本轮结果分类 */
    private retryOne;
    /** 崩溃遗留的 Pending 退款：先结算；结算失败置 Failed 让余额重新可见（绝不重复退款） */
    private settleCrashedPending;
    /** 退款+取消成功后落终态（条件更新，绝不覆盖人工已改写的状态） */
    private markResolved;
    /** 耗尽升级：飞书告警 + 系统工单（人工待办），只会发一次 */
    private escalate;
    private lastError;
    private clearState;
    private orderSvc;
    /** 存量隔离：只自动处理「作业安装后」进入/刷新到 refund_failed 的单 */
    private cutoff;
}
