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
exports.PendingRefundAuditJob = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const periodic_fallback_1 = require("./periodic-fallback");
const loggerCtx = 'CampusPendingRefundAudit';
const ALERT_TTL_MS = 6 * 3600000;
/** 同一退款单 6 小时内只告警一次（跨实例经去重表） */
const alertKey = (refundId) => `campus:pending_refund_alert:${refundId}`;
/**
 * 全局「待退款超 24 小时」巡检（只读）。
 *
 * 之前只有外卖 refund_failed / 售后失败有重试，Vendure 退款单本身停在 Pending 无人发现：
 * createRefund 只落单、不 settleRefund 时，退款单会永久 Pending 且没有任何告警。
 * 本作业只 SELECT + 飞书告警，绝不调用 settleRefund、绝不改任何数据；
 * 真正补打款/人工处理仍由各业务路径与人工工单负责。
 */
let PendingRefundAuditJob = class PendingRefundAuditJob {
    constructor(connection, dedupe, feishu) {
        this.connection = connection;
        this.dedupe = dedupe;
        this.feishu = feishu;
        this.fallback = null;
    }
    start(intervalMs = 10 * 60000) {
        this.fallback = new periodic_fallback_1.PeriodicFallback({
            name: 'campus-pending-refund-audit',
            intervalMs,
            bootDelayMs: 90000,
            loggerCtx,
        });
        this.fallback.start(() => this.runOnce());
    }
    onApplicationShutdown() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
    }
    async runOnce() {
        var _a, _b, _c, _d, _e, _f;
        const stuck = await this.scan();
        if (!stuck.length)
            return;
        core_1.Logger.warn(`退款单待处理超 24 小时：${stuck.length} 笔`, loggerCtx);
        for (const r of stuck) {
            // 去重命中说明近期已告警过；去重不可用时 CampusDedupeService 自带内存降级
            if (await this.dedupe.seenOrMark(alertKey(Number(r.id)), ALERT_TTL_MS))
                continue;
            const hours = Math.max(0, (Date.now() - new Date(r.createdAt).getTime()) / 3600000);
            const detail = [
                `退款单：${r.id}`,
                `订单：${(_b = (_a = r.orderCode) !== null && _a !== void 0 ? _a : r.orderId) !== null && _b !== void 0 ? _b : '未知'}`,
                `金额：${(Number(r.total) / 100).toFixed(2)} 元（${Number(r.total)} 分）`,
                `卡住：${hours.toFixed(1)} 小时（创建于 ${r.createdAt}）`,
                `来源：${(_c = r.method) !== null && _c !== void 0 ? _c : '未知支付方式'}${r.reason ? `／${r.reason}` : ''}`,
                `状态：${r.state}（巡检只读，需人工推进结算）`,
            ].join('；');
            try {
                await this.feishu.pushEvent('exception', '退款单待处理超 24 小时', detail, (_d = r.orderCode) !== null && _d !== void 0 ? _d : undefined, `pending_refund_overdue:${r.id}`);
            }
            catch (e) {
                core_1.Logger.error(`退款单超期告警失败 refund=${r.id}: ${String((_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e)}`, loggerCtx);
            }
            core_1.Logger.error(`退款单待处理超 24 小时 refund=${r.id} order=${(_f = r.orderCode) !== null && _f !== void 0 ? _f : '?'} total=${r.total}`, loggerCtx);
        }
    }
    async scan() {
        const out = await this.connection.rawConnection.query(`SELECT r.id, r.total, r."createdAt", r.reason, r.state,
                    p.method AS method,
                    o.id AS "orderId", o.code AS "orderCode"
               FROM refund r
               JOIN payment p ON r."paymentId" = p.id
               LEFT JOIN "order" o ON p."orderId" = o.id
              WHERE r.state = 'Pending'
                AND r."createdAt" < now() - interval '24 hours'
              ORDER BY r."createdAt"
              LIMIT 200`);
        const rows = Array.isArray(out) ? out[0] : [];
        return (rows !== null && rows !== void 0 ? rows : []);
    }
};
exports.PendingRefundAuditJob = PendingRefundAuditJob;
exports.PendingRefundAuditJob = PendingRefundAuditJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        campus_dedupe_service_1.CampusDedupeService,
        feishu_notify_service_1.FeishuNotifyService])
], PendingRefundAuditJob);
//# sourceMappingURL=pending-refund-audit.job.js.map