import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    ID,
    Injector,
    Logger,
    OrderService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { CampusDedupeService } from './campus-dedupe.service';
import { isFirstLegFulfilled } from './dispatch-job.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { PeriodicFallback } from './periodic-fallback';
import { createOrderRefund, refundablePayments, settleRefundOrMarkFailed } from './refund-payment';
import { withRefundLock } from './refund-lock';
import { SupportService } from './support.service';

const loggerCtx = 'CampusRefundRetry';

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
export const REFUND_RETRY_MAX_ATTEMPTS = 4;
/** 第 1/2/3 次失败后的等待分钟数；第 4 次失败即升级人工 */
export const REFUND_RETRY_BACKOFF_MINUTES = [2, 10, 30];
/** 每轮扫描上限，避免单轮过长 */
const SCAN_LIMIT = 20;
/** 尝试次数/失败原因保留 7 天（足够覆盖人工处置周期；订单离开 refund_failed 后即清理） */
export const RETRY_STATE_TTL_MS = 7 * 24 * 3600_000;
/** 存量隔离标记保留 10 年（等价于「永久」；丢失则重新以当前时间为界） */
const INSTALLED_TTL_MS = 3650 * 24 * 3600_000;

const ATTEMPTS_KEY = (id: number | string) => `campus:refund_retry:attempts:${id}`;
const NEXT_KEY = (id: number | string) => `campus:refund_retry:next:${id}`;
const ERROR_KEY = (id: number | string) => `campus:refund_retry:error:${id}`;
const EXHAUSTED_KEY = (id: number | string) => `campus:refund_retry:exhausted:${id}`;
const INSTALLED_KEY = 'campus:refund_retry:installed_at';

type Row = Record<string, any>;

interface ScannedOrder {
    id: number;
    code: string;
    state: string;
    hallStatus: string | null;
    deliveryStatus: string | null;
    deliveredAt?: string | Date | null;
    /** A4 方案二：第一段履约判定字段（handoverAt 为权威，其余为历史数据兜底） */
    handoverAt?: string | Date | null;
    leg1Status?: string | null;
    thirdPartyState?: string | null;
}

export interface RefundRetryRunResult {
    done: number;
    retried: number;
    escalated: number;
    skipped: number;
}

function rowsOf(result: any): Row[] {
    return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : Array.isArray(result) ? result : [];
}

@Injectable()
export class RefundRetryJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;
    /** 单测注入点：替换 OrderService（避免构造整个 Vendure 容器） */
    orderSvcOverride: Pick<any, 'refundOrder' | 'settleRefund' | 'cancelOrder'> | null = null;
    /** 单测注入点：固定存量隔离时间 */
    cutoffOverride: Date | null = null;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly dedupe: CampusDedupeService,
        private readonly feishu: FeishuNotifyService,
        private readonly support: SupportService,
        private readonly requestContextService: RequestContextService,
        private readonly moduleRef: ModuleRef,
    ) {}

    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项，直接注入会导致插件启动失败） */
    private get injector(): Injector {
        return new Injector(this.moduleRef);
    }

    start(intervalMs = 60_000): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'campus-refund-retry',
            intervalMs,
            // 等启动/迁移/DB 连接稳定后再跑首轮，避免与启动时的退款动作抢锁
            bootDelayMs: 90_000,
            loggerCtx,
        });
        this.fallback.start(() => this.runOnce());
    }

    onApplicationShutdown(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    /** 手动触发一轮（运维/单测） */
    async trigger(): Promise<void> {
        await this.fallback?.trigger();
    }

    async runOnce(): Promise<RefundRetryRunResult> {
        const result: RefundRetryRunResult = { done: 0, retried: 0, escalated: 0, skipped: 0 };
        const cutoff = await this.cutoff();
        const scanned = rowsOf(
            await this.connection.rawConnection.query(
                `SELECT id, code, state, "customFieldsHallstatus" AS "hallStatus",
                        "customFieldsDeliverystatus" AS "deliveryStatus",
                        "customFieldsDeliveredat" AS "deliveredAt"
                   FROM "order"
                  WHERE "customFieldsHallstatus" = 'refund_failed'
                    AND "updatedAt" >= $1
                  ORDER BY "updatedAt" ASC
                  LIMIT $2`,
                [cutoff.toISOString(), SCAN_LIMIT],
            ),
        ) as ScannedOrder[];

        for (const order of scanned) {
            try {
                // 退避窗口内：本轮不碰（失败后已 mark）
                if (await this.dedupe.seen(NEXT_KEY(order.id), RETRY_STATE_TTL_MS)) {
                    result.skipped += 1;
                    continue;
                }
                const ctx = await this.requestContextService.create({ apiType: 'admin' });
                const locked = await withRefundLock(this.connection, order.id, () => this.retryOne(order, ctx));
                if (!locked.ok) {
                    // 另一路（商家拒单/人工认领/改址）正在处理同一订单：不消耗尝试次数
                    result.skipped += 1;
                    continue;
                }
                result[locked.value] += 1;
            } catch (e: any) {
                // 单条异常不影响其余扫描
                Logger.error(`退款重试扫描单条失败 order=${order.id}: ${String(e?.message ?? e)}`, loggerCtx);
                result.skipped += 1;
            }
        }
        if (scanned.length) {
            Logger.info(
                `退款重试轮次：扫描 ${scanned.length}，完成 ${result.done}，待重试 ${result.retried}，`
                    + `升级人工 ${result.escalated}，跳过 ${result.skipped}`,
                loggerCtx,
            );
        }
        return result;
    }

    /** 锁内执行；返回本轮结果分类 */
    private async retryOne(order: ScannedOrder, ctx: RequestContext): Promise<'done' | 'retried' | 'escalated' | 'skipped'> {
        const fresh = rowsOf(
            await this.connection.rawConnection.query(
                `SELECT id, code, state, "customFieldsHallstatus" AS "hallStatus",
                        "customFieldsDeliverystatus" AS "deliveryStatus",
                        "customFieldsDeliveredat" AS "deliveredAt",
                        "customFieldsHandoverat" AS "handoverAt",
                        "customFieldsLeg1status" AS "leg1Status",
                        "customFieldsThirdpartystate" AS "thirdPartyState"
                   FROM "order" WHERE id = $1`,
                [order.id],
            ),
        )[0] as ScannedOrder | undefined;
        // 锁内复查：排队等锁期间人工可能已认领/已改派
        if (!fresh || String(fresh.hallStatus ?? '') !== 'refund_failed') return 'skipped';
        // A4 方案二：第一段已履约的单禁止自动整单退款（存量 refund_failed 兜底）。
        // 先条件退出 refund_failed（避免下一轮又被捞起），再走 A9 升级通道转人工。
        if (isFirstLegFulfilled(fresh)) {
            await this.leaveForManualFirstLeg(fresh);
            return 'escalated';
        }

        const attempts = await this.dedupe.incr(ATTEMPTS_KEY(fresh.id), RETRY_STATE_TTL_MS);
        if (attempts > REFUND_RETRY_MAX_ATTEMPTS) {
            // 达到上限：可能上次尝试在升级前崩溃，这里补一次升级（幂等）
            await this.escalate(fresh, REFUND_RETRY_MAX_ATTEMPTS, await this.lastError(fresh.id));
            return 'escalated';
        }

        try {
            const orderSvc = this.orderSvc();
            await this.settleCrashedPending(fresh.id, orderSvc, ctx);

            // 统一可退口径：仅 Settled/Authorized 且余额 > 0（余额已扣除 Pending/Settled 退款，排除 Failed）
            const refundable = await refundablePayments(this.connection, fresh.id);
            for (const picked of refundable) {
                const created: any = await createOrderRefund(orderSvc, ctx, {
                    orderId: fresh.id,
                    paymentId: picked.payment.id,
                    amount: picked.remaining,
                    // 非 COD 路径由 helper 显式给 shipping/adjustment=0（refund 表 NOT NULL）
                    reason: `refund_failed auto retry (${fresh.code}) attempt ${attempts}`,
                    paymentMethod: picked.payment.method,
                });
                if (!created || created instanceof Error || (created as any).errorCode) {
                    throw new Error(
                        `refundOrder failed: ${(created as any)?.errorCode ?? (created as any)?.message ?? 'no result'}`,
                    );
                }
                await settleRefundOrMarkFailed(this.connection, orderSvc as any, ctx, (created as any).id);
            }

            // 已送达单不应再取消（A11）：送达后取消会污染对账/分账，入口直接跳过取消
            const delivered = !!fresh.deliveredAt
                || String(fresh.hallStatus ?? '') === 'delivered'
                || String(fresh.deliveryStatus ?? '') === 'delivered';
            if (delivered) {
                Logger.warn(`退款重试跳过取消：order=${fresh.code} 已送达`, loggerCtx);
            } else if (String(fresh.state ?? '') !== 'Cancelled') {
                let cancelled: any = await orderSvc.cancelOrder(ctx, {
                    orderId: fresh.id as ID,
                    reason: `refund_failed auto retry cancel (${fresh.code})`,
                } as any);
                if (cancelled && (cancelled as any).errorCode) {
                    cancelled = await orderSvc.cancelOrder(ctx, {
                        orderId: fresh.id as ID,
                        reason: `refund_failed auto retry cancel retry (${fresh.code})`,
                    } as any);
                }
                if (cancelled && (cancelled as any).errorCode) {
                    throw new Error(`cancelOrder failed: ${(cancelled as any).errorCode}`);
                }
            }

            await this.markResolved(fresh);
            await this.clearState(fresh.id);
            Logger.warn(
                `退款重试成功 order=${fresh.code} attempts=${attempts}`
                    + (refundable.length ? '' : '（无待退余额，仅补取消/落终态）'),
                loggerCtx,
            );
            return 'done';
        } catch (e: any) {
            const message = String(e?.message ?? e);
            await this.dedupe.setJson(ERROR_KEY(fresh.id), { message, at: new Date().toISOString() }, RETRY_STATE_TTL_MS);
            Logger.error(`退款重试失败 order=${fresh.code} attempt=${attempts}/${REFUND_RETRY_MAX_ATTEMPTS}: ${message}`, loggerCtx);
            if (attempts >= REFUND_RETRY_MAX_ATTEMPTS) {
                await this.escalate(fresh, attempts, message);
                return 'escalated';
            }
            const minutes = REFUND_RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, REFUND_RETRY_BACKOFF_MINUTES.length - 1)];
            await this.dedupe.mark(NEXT_KEY(fresh.id), minutes * 60_000);
            return 'retried';
        }
    }

    /** A4 方案二：第一段已履约的 refund_failed 存量单 → 退出重试并转人工（绝不自动退款） */
    private async leaveForManualFirstLeg(order: ScannedOrder): Promise<void> {
        const moved = rowsOf(
            await this.connection.rawConnection.query(
                `UPDATE "order"
                    SET "customFieldsHallstatus" = 'no_rider_manual',
                        "customFieldsCampuscause" = 'first_leg_no_rider'
                  WHERE id = $1 AND "customFieldsHallstatus" = 'refund_failed'
                  RETURNING id`,
                [order.id],
            ),
        );
        if (!moved.length) {
            // 锁内已被人工认领/取消：不覆盖
            Logger.warn(`退款重试跳过：第一段已履约但状态已被改写 order=${order.code}`, loggerCtx);
            return;
        }
        await this.escalate(
            order,
            0,
            '第一段已履约，禁止自动整单退款，请人工决定退款/重派/补偿',
            '第一段已履约，转人工（未自动退款）',
        );
        await this.clearState(order.id);
    }

    /** 崩溃遗留的 Pending 退款：先结算；结算失败置 Failed 让余额重新可见（绝不重复退款） */
    private async settleCrashedPending(orderId: number, orderSvc: any, ctx: RequestContext): Promise<void> {
        const pending = rowsOf(
            await this.connection.rawConnection.query(
                `SELECT r.id, r."paymentId" AS "paymentId"
                   FROM refund r
                   JOIN payment p ON p.id = r."paymentId"
                  WHERE p."orderId" = $1 AND r.state = 'Pending'
                  ORDER BY r.id`,
                [orderId],
            ),
        );
        for (const row of pending) {
            try {
                await orderSvc.settleRefund(ctx, { id: row.id, transactionId: row.paymentId });
            } catch (e: any) {
                Logger.warn(
                    `遗留 Pending 退款结算失败 order=${orderId} refund=${row.id}，置 Failed 后重算余额: ${String(e?.message ?? e)}`,
                    loggerCtx,
                );
                await this.connection.rawConnection
                    .query(`UPDATE refund SET state = 'Failed' WHERE id = $1 AND state = 'Pending'`, [row.id])
                    .catch(() => undefined);
            }
        }
    }

    /** 退款+取消成功后落终态（条件更新，绝不覆盖人工已改写的状态） */
    private async markResolved(order: ScannedOrder): Promise<void> {
        const isException = String(order.deliveryStatus ?? '') === 'exception';
        const updated = rowsOf(
            await this.connection.rawConnection.query(
                isException
                    ? `UPDATE "order"
                          SET "customFieldsHallstatus" = 'exception_final',
                              "customFieldsCampuscause" = 'exception_refund',
                              "customFieldsExceptionhandledat" = now(),
                              "customFieldsExceptionaction" = 'refund_all',
                              "customFieldsExceptionhandledby" = 'system:refund_retry',
                              "customFieldsExceptionhandlednote" = '退款自动重试成功'
                        WHERE id = $1 AND "customFieldsHallstatus" = 'refund_failed'
                        RETURNING id`
                    : `UPDATE "order"
                          SET "customFieldsHallstatus" = 'no_rider_final',
                              "customFieldsCampuscause" = 'no_rider'
                        WHERE id = $1 AND "customFieldsHallstatus" = 'refund_failed'
                        RETURNING id`,
                [order.id],
            ),
        );
        if (!updated.length) {
            // 锁内被其他路径改写（如人工认领）：退款已完成，仅告警不重试
            Logger.warn(`退款重试完成但订单状态已被改写，跳过落终态 order=${order.code}`, loggerCtx);
        }
    }

    /** 耗尽升级：飞书告警 + 系统工单（人工待办），只会发一次 */
    private async escalate(
        order: ScannedOrder,
        attempts: number,
        reason: string,
        title = '退款自动重试耗尽，转人工',
    ): Promise<void> {
        if (await this.dedupe.seenOrMark(EXHAUSTED_KEY(order.id), INSTALLED_TTL_MS)) return;

        let paid = 0;
        let remaining = 0;
        try {
            const paidRows = rowsOf(
                await this.connection.rawConnection.query(
                    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payment
                      WHERE "orderId" = $1 AND state IN ('Settled', 'Authorized')`,
                    [order.id],
                ),
            );
            paid = Number(paidRows[0]?.paid ?? 0);
            const list = await refundablePayments(this.connection, order.id);
            remaining = list.reduce((sum, p) => sum + p.remaining, 0);
        } catch (e: any) {
            Logger.warn(`退款重试升级金额核算失败 order=${order.code}: ${String(e?.message ?? e)}`, loggerCtx);
        }

        const yuan = (fen: number) => (fen / 100).toFixed(2);
        const detail = [
            `订单：${order.code}`,
            `应付：${yuan(paid)} 元（${paid} 分）`,
            `待退：${yuan(remaining)} 元（${remaining} 分）`,
            `失败原因：${reason || '未知'}`,
            `已尝试：${attempts} 次（上限 ${REFUND_RETRY_MAX_ATTEMPTS}）`,
        ].join('；');

        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        let ticketId: string | number | null = null;
        try {
            const channelRows = rowsOf(
                await this.connection.rawConnection.query(
                    `SELECT "channelId" FROM order_channels_channel WHERE "orderId" = $1 LIMIT 1`,
                    [order.id],
                ),
            );
            const ticket: any = await this.support.createSystemTicket(ctx, {
                dedupeKey: `refund_retry_exhausted:${order.code}`,
                orderCode: order.code,
                orderId: order.id as ID,
                channelId: channelRows[0]?.channelId as ID | undefined,
                category: 'refund',
                source: 'refund_retry_exhausted',
                content: `${detail}；请人工核对支付渠道后完成退款/取消，勿重复退款`,
            } as any);
            ticketId = ticket?.id ?? null;
        } catch (e: any) {
            Logger.error(`退款重试升级建工单失败 order=${order.code}: ${String(e?.message ?? e)}`, loggerCtx);
        }

        try {
            await this.feishu.pushEvent(
                'exception',
                title,
                `${detail}${ticketId ? `；工单 ${ticketId}` : '；工单创建失败，请直接在调度台认领'}`,
                order.code,
                `refund_retry_exhausted:${order.code}`,
            );
        } catch (e: any) {
            Logger.error(`退款重试升级飞书告警失败 order=${order.code}: ${String(e?.message ?? e)}`, loggerCtx);
        }
        Logger.error(
            `退款自动重试耗尽转人工 order=${order.code} attempts=${attempts}: ${reason}`,
            loggerCtx,
        );
    }

    private async lastError(orderId: number): Promise<string> {
        const stored = await this.dedupe.getJson<{ message?: string }>(ERROR_KEY(orderId));
        return stored?.message ?? '未知（上次尝试未记录原因）';
    }

    private async clearState(orderId: number): Promise<void> {
        await this.dedupe.del(ATTEMPTS_KEY(orderId));
        await this.dedupe.del(NEXT_KEY(orderId));
        await this.dedupe.del(ERROR_KEY(orderId));
        await this.dedupe.del(EXHAUSTED_KEY(orderId));
    }

    private orderSvc(): any {
        return this.orderSvcOverride ?? this.injector.get(OrderService);
    }

    /** 存量隔离：只自动处理「作业安装后」进入/刷新到 refund_failed 的单 */
    private async cutoff(): Promise<Date> {
        if (this.cutoffOverride) return this.cutoffOverride;
        const stored = await this.dedupe.getJson<{ at?: string }>(INSTALLED_KEY);
        if (stored?.at) {
            const at = new Date(stored.at);
            if (!Number.isNaN(at.getTime())) return at;
        }
        const at = new Date();
        await this.dedupe.setJson(INSTALLED_KEY, { at: at.toISOString() }, INSTALLED_TTL_MS);
        Logger.warn(`退款重试作业首次启用，存量隔离时间=${at.toISOString()}（更早的 refund_failed 需人工处置）`, loggerCtx);
        return at;
    }
}
