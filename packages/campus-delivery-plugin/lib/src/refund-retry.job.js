"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefundRetryJob = exports.RETRY_STATE_TTL_MS = exports.REFUND_RETRY_BACKOFF_MINUTES = exports.REFUND_RETRY_MAX_ATTEMPTS = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const periodic_fallback_1 = require("./periodic-fallback");
const refund_payment_1 = require("./refund-payment");
const refund_lock_1 = require("./refund-lock");
const support_service_1 = require("./support.service");
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
exports.REFUND_RETRY_MAX_ATTEMPTS = 4;
/** 第 1/2/3 次失败后的等待分钟数；第 4 次失败即升级人工 */
exports.REFUND_RETRY_BACKOFF_MINUTES = [2, 10, 30];
/** 每轮扫描上限，避免单轮过长 */
const SCAN_LIMIT = 20;
/** 尝试次数/失败原因保留 7 天（足够覆盖人工处置周期；订单离开 refund_failed 后即清理） */
exports.RETRY_STATE_TTL_MS = 7 * 24 * 3600000;
/** 存量隔离标记保留 10 年（等价于「永久」；丢失则重新以当前时间为界） */
const INSTALLED_TTL_MS = 3650 * 24 * 3600000;
const ATTEMPTS_KEY = (id) => `campus:refund_retry:attempts:${id}`;
const NEXT_KEY = (id) => `campus:refund_retry:next:${id}`;
const ERROR_KEY = (id) => `campus:refund_retry:error:${id}`;
const EXHAUSTED_KEY = (id) => `campus:refund_retry:exhausted:${id}`;
const INSTALLED_KEY = 'campus:refund_retry:installed_at';
function rowsOf(result) {
    return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : Array.isArray(result) ? result : [];
}
let RefundRetryJob = class RefundRetryJob {
    constructor(connection, dedupe, feishu, support, requestContextService, moduleRef) {
        this.connection = connection;
        this.dedupe = dedupe;
        this.feishu = feishu;
        this.support = support;
        this.requestContextService = requestContextService;
        this.moduleRef = moduleRef;
        this.fallback = null;
        /** 单测注入点：替换 OrderService（避免构造整个 Vendure 容器） */
        this.orderSvcOverride = null;
        /** 单测注入点：固定存量隔离时间 */
        this.cutoffOverride = null;
    }
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项，直接注入会导致插件启动失败） */
    get injector() {
        return new core_2.Injector(this.moduleRef);
    }
    start(intervalMs = 60000) {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({
            name: 'campus-refund-retry',
            intervalMs,
            // 等启动/迁移/DB 连接稳定后再跑首轮，避免与启动时的退款动作抢锁
            bootDelayMs: 90000,
            loggerCtx,
        });
        this.fallback.start(() => this.runOnce());
    }
    onApplicationShutdown() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
    /** 手动触发一轮（运维/单测） */
    async trigger() {
        var _a;
        await ((_a = this.fallback) === null || _a === void 0 ? void 0 : _a.trigger());
    }
    async runOnce() {
        var _a;
        const result = { done: 0, retried: 0, escalated: 0, skipped: 0 };
        const cutoff = await this.cutoff();
        const scanned = rowsOf(await this.connection.rawConnection.query(`SELECT id, code, state, "customFieldsHallstatus" AS "hallStatus",
                        "customFieldsDeliverystatus" AS "deliveryStatus",
                        "customFieldsDeliveredat" AS "deliveredAt"
                   FROM "order"
                  WHERE "customFieldsHallstatus" = 'refund_failed'
                    AND "updatedAt" >= $1
                  ORDER BY "updatedAt" ASC
                  LIMIT $2`, [cutoff.toISOString(), SCAN_LIMIT]));
        for (const order of scanned) {
            try {
                // 退避窗口内：本轮不碰（失败后已 mark）
                if (await this.dedupe.seen(NEXT_KEY(order.id), exports.RETRY_STATE_TTL_MS)) {
                    result.skipped += 1;
                    continue;
                }
                const ctx = await this.requestContextService.create({ apiType: 'admin' });
                const locked = await (0, refund_lock_1.withRefundLock)(this.connection, order.id, () => this.retryOne(order, ctx));
                if (!locked.ok) {
                    // 另一路（商家拒单/人工认领/改址）正在处理同一订单：不消耗尝试次数
                    result.skipped += 1;
                    continue;
                }
                result[locked.value] += 1;
            }
            catch (e) {
                // 单条异常不影响其余扫描
                core_2.Logger.error(`退款重试扫描单条失败 order=${order.id}: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx);
                result.skipped += 1;
            }
        }
        if (scanned.length) {
            core_2.Logger.info(`退款重试轮次：扫描 ${scanned.length}，完成 ${result.done}，待重试 ${result.retried}，`
                + `升级人工 ${result.escalated}，跳过 ${result.skipped}`, loggerCtx);
        }
        return result;
    }
    /** 锁内执行；返回本轮结果分类 */
    async retryOne(order, ctx) {
        var _a, _b, _c, _d, _e, _f, _g;
        const fresh = rowsOf(await this.connection.rawConnection.query(`SELECT id, code, state, "customFieldsHallstatus" AS "hallStatus",
                        "customFieldsDeliverystatus" AS "deliveryStatus",
                        "customFieldsDeliveredat" AS "deliveredAt"
                   FROM "order" WHERE id = $1`, [order.id]))[0];
        // 锁内复查：排队等锁期间人工可能已认领/已改派
        if (!fresh || String((_a = fresh.hallStatus) !== null && _a !== void 0 ? _a : '') !== 'refund_failed')
            return 'skipped';
        const attempts = await this.dedupe.incr(ATTEMPTS_KEY(fresh.id), exports.RETRY_STATE_TTL_MS);
        if (attempts > exports.REFUND_RETRY_MAX_ATTEMPTS) {
            // 达到上限：可能上次尝试在升级前崩溃，这里补一次升级（幂等）
            await this.escalate(fresh, exports.REFUND_RETRY_MAX_ATTEMPTS, await this.lastError(fresh.id));
            return 'escalated';
        }
        try {
            const orderSvc = this.orderSvc();
            await this.settleCrashedPending(fresh.id, orderSvc, ctx);
            // 统一可退口径：仅 Settled/Authorized 且余额 > 0（余额已扣除 Pending/Settled 退款，排除 Failed）
            const refundable = await (0, refund_payment_1.refundablePayments)(this.connection, fresh.id);
            for (const picked of refundable) {
                const created = await (0, refund_payment_1.createOrderRefund)(orderSvc, ctx, {
                    orderId: fresh.id,
                    paymentId: picked.payment.id,
                    amount: picked.remaining,
                    // 非 COD 路径由 helper 显式给 shipping/adjustment=0（refund 表 NOT NULL）
                    reason: `refund_failed auto retry (${fresh.code}) attempt ${attempts}`,
                    paymentMethod: picked.payment.method,
                });
                if (!created || created instanceof Error || created.errorCode) {
                    throw new Error(`refundOrder failed: ${(_c = (_b = created === null || created === void 0 ? void 0 : created.errorCode) !== null && _b !== void 0 ? _b : created === null || created === void 0 ? void 0 : created.message) !== null && _c !== void 0 ? _c : 'no result'}`);
                }
                await (0, refund_payment_1.settleRefundOrMarkFailed)(this.connection, orderSvc, ctx, created.id);
            }
            // 已送达单不应再取消（A11）：送达后取消会污染对账/分账，入口直接跳过取消
            const delivered = !!fresh.deliveredAt
                || String((_d = fresh.hallStatus) !== null && _d !== void 0 ? _d : '') === 'delivered'
                || String((_e = fresh.deliveryStatus) !== null && _e !== void 0 ? _e : '') === 'delivered';
            if (delivered) {
                core_2.Logger.warn(`退款重试跳过取消：order=${fresh.code} 已送达`, loggerCtx);
            }
            else if (String((_f = fresh.state) !== null && _f !== void 0 ? _f : '') !== 'Cancelled') {
                let cancelled = await orderSvc.cancelOrder(ctx, {
                    orderId: fresh.id,
                    reason: `refund_failed auto retry cancel (${fresh.code})`,
                });
                if (cancelled && cancelled.errorCode) {
                    cancelled = await orderSvc.cancelOrder(ctx, {
                        orderId: fresh.id,
                        reason: `refund_failed auto retry cancel retry (${fresh.code})`,
                    });
                }
                if (cancelled && cancelled.errorCode) {
                    throw new Error(`cancelOrder failed: ${cancelled.errorCode}`);
                }
            }
            await this.markResolved(fresh);
            await this.clearState(fresh.id);
            core_2.Logger.warn(`退款重试成功 order=${fresh.code} attempts=${attempts}`
                + (refundable.length ? '' : '（无待退余额，仅补取消/落终态）'), loggerCtx);
            return 'done';
        }
        catch (e) {
            const message = String((_g = e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : e);
            await this.dedupe.setJson(ERROR_KEY(fresh.id), { message, at: new Date().toISOString() }, exports.RETRY_STATE_TTL_MS);
            core_2.Logger.error(`退款重试失败 order=${fresh.code} attempt=${attempts}/${exports.REFUND_RETRY_MAX_ATTEMPTS}: ${message}`, loggerCtx);
            if (attempts >= exports.REFUND_RETRY_MAX_ATTEMPTS) {
                await this.escalate(fresh, attempts, message);
                return 'escalated';
            }
            const minutes = exports.REFUND_RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, exports.REFUND_RETRY_BACKOFF_MINUTES.length - 1)];
            await this.dedupe.mark(NEXT_KEY(fresh.id), minutes * 60000);
            return 'retried';
        }
    }
    /** 崩溃遗留的 Pending 退款：先结算；结算失败置 Failed 让余额重新可见（绝不重复退款） */
    async settleCrashedPending(orderId, orderSvc, ctx) {
        var _a;
        const pending = rowsOf(await this.connection.rawConnection.query(`SELECT r.id, r."paymentId" AS "paymentId"
                   FROM refund r
                   JOIN payment p ON p.id = r."paymentId"
                  WHERE p."orderId" = $1 AND r.state = 'Pending'
                  ORDER BY r.id`, [orderId]));
        for (const row of pending) {
            try {
                await orderSvc.settleRefund(ctx, { id: row.id, transactionId: row.paymentId });
            }
            catch (e) {
                core_2.Logger.warn(`遗留 Pending 退款结算失败 order=${orderId} refund=${row.id}，置 Failed 后重算余额: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx);
                await this.connection.rawConnection
                    .query(`UPDATE refund SET state = 'Failed' WHERE id = $1 AND state = 'Pending'`, [row.id])
                    .catch(() => undefined);
            }
        }
    }
    /** 退款+取消成功后落终态（条件更新，绝不覆盖人工已改写的状态） */
    async markResolved(order) {
        var _a;
        const isException = String((_a = order.deliveryStatus) !== null && _a !== void 0 ? _a : '') === 'exception';
        const updated = rowsOf(await this.connection.rawConnection.query(isException
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
                        RETURNING id`, [order.id]));
        if (!updated.length) {
            // 锁内被其他路径改写（如人工认领）：退款已完成，仅告警不重试
            core_2.Logger.warn(`退款重试完成但订单状态已被改写，跳过落终态 order=${order.code}`, loggerCtx);
        }
    }
    /** 耗尽升级：飞书告警 + 系统工单（人工待办），只会发一次 */
    async escalate(order, attempts, reason) {
        var _a, _b, _c, _d, _e, _f, _g;
        if (await this.dedupe.seenOrMark(EXHAUSTED_KEY(order.id), INSTALLED_TTL_MS))
            return;
        let paid = 0;
        let remaining = 0;
        try {
            const paidRows = rowsOf(await this.connection.rawConnection.query(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payment
                      WHERE "orderId" = $1 AND state IN ('Settled', 'Authorized')`, [order.id]));
            paid = Number((_b = (_a = paidRows[0]) === null || _a === void 0 ? void 0 : _a.paid) !== null && _b !== void 0 ? _b : 0);
            const list = await (0, refund_payment_1.refundablePayments)(this.connection, order.id);
            remaining = list.reduce((sum, p) => sum + p.remaining, 0);
        }
        catch (e) {
            core_2.Logger.warn(`退款重试升级金额核算失败 order=${order.code}: ${String((_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e)}`, loggerCtx);
        }
        const yuan = (fen) => (fen / 100).toFixed(2);
        const detail = [
            `订单：${order.code}`,
            `应付：${yuan(paid)} 元（${paid} 分）`,
            `待退：${yuan(remaining)} 元（${remaining} 分）`,
            `失败原因：${reason || '未知'}`,
            `已尝试：${attempts} 次（上限 ${exports.REFUND_RETRY_MAX_ATTEMPTS}）`,
        ].join('；');
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        let ticketId = null;
        try {
            const channelRows = rowsOf(await this.connection.rawConnection.query(`SELECT "channelId" FROM order_channels_channel WHERE "orderId" = $1 LIMIT 1`, [order.id]));
            const ticket = await this.support.createSystemTicket(ctx, {
                dedupeKey: `refund_retry_exhausted:${order.code}`,
                orderCode: order.code,
                orderId: order.id,
                channelId: (_d = channelRows[0]) === null || _d === void 0 ? void 0 : _d.channelId,
                category: 'refund',
                source: 'refund_retry_exhausted',
                content: `${detail}；请人工核对支付渠道后完成退款/取消，勿重复退款`,
            });
            ticketId = (_e = ticket === null || ticket === void 0 ? void 0 : ticket.id) !== null && _e !== void 0 ? _e : null;
        }
        catch (e) {
            core_2.Logger.error(`退款重试升级建工单失败 order=${order.code}: ${String((_f = e === null || e === void 0 ? void 0 : e.message) !== null && _f !== void 0 ? _f : e)}`, loggerCtx);
        }
        try {
            await this.feishu.pushEvent('exception', '退款自动重试耗尽，转人工', `${detail}${ticketId ? `；工单 ${ticketId}` : '；工单创建失败，请直接在调度台认领'}`, order.code, `refund_retry_exhausted:${order.code}`);
        }
        catch (e) {
            core_2.Logger.error(`退款重试升级飞书告警失败 order=${order.code}: ${String((_g = e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : e)}`, loggerCtx);
        }
        core_2.Logger.error(`退款自动重试耗尽转人工 order=${order.code} attempts=${attempts}: ${reason}`, loggerCtx);
    }
    async lastError(orderId) {
        var _a;
        const stored = await this.dedupe.getJson(ERROR_KEY(orderId));
        return (_a = stored === null || stored === void 0 ? void 0 : stored.message) !== null && _a !== void 0 ? _a : '未知（上次尝试未记录原因）';
    }
    async clearState(orderId) {
        await this.dedupe.del(ATTEMPTS_KEY(orderId));
        await this.dedupe.del(NEXT_KEY(orderId));
        await this.dedupe.del(ERROR_KEY(orderId));
        await this.dedupe.del(EXHAUSTED_KEY(orderId));
    }
    orderSvc() {
        var _a;
        return (_a = this.orderSvcOverride) !== null && _a !== void 0 ? _a : this.injector.get(core_2.OrderService);
    }
    /** 存量隔离：只自动处理「作业安装后」进入/刷新到 refund_failed 的单 */
    async cutoff() {
        if (this.cutoffOverride)
            return this.cutoffOverride;
        const stored = await this.dedupe.getJson(INSTALLED_KEY);
        if (stored === null || stored === void 0 ? void 0 : stored.at) {
            const at = new Date(stored.at);
            if (!Number.isNaN(at.getTime()))
                return at;
        }
        const at = new Date();
        await this.dedupe.setJson(INSTALLED_KEY, { at: at.toISOString() }, INSTALLED_TTL_MS);
        core_2.Logger.warn(`退款重试作业首次启用，存量隔离时间=${at.toISOString()}（更早的 refund_failed 需人工处置）`, loggerCtx);
        return at;
    }
};
exports.RefundRetryJob = RefundRetryJob;
exports.RefundRetryJob = RefundRetryJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_2.TransactionalConnection,
        campus_dedupe_service_1.CampusDedupeService,
        feishu_notify_service_1.FeishuNotifyService,
        support_service_1.SupportService,
        core_2.RequestContextService,
        core_1.ModuleRef])
], RefundRetryJob);
//# sourceMappingURL=refund-retry.job.js.map