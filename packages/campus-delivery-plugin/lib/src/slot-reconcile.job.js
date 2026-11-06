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
var SlotReconcileJob_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlotReconcileJob = exports.SLOT_DRIFT_SQL = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const advisory_lock_1 = require("./advisory-lock");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const periodic_fallback_1 = require("./periodic-fallback");
/**
 * 锁位对账（R3）：只读比对 delivery_slot.lockedCount 与订单 customFields.slotLocked。
 * 崩溃窗（容量 +1 后进程退出）会形成「容量多计」幽灵占位；取消释放失败会留下「已取消仍占位」。
 * 仅告警、不自动改容量——先观测 2 周，确认偏差真实存在后再引入 claiming 中间态。
 */
exports.SLOT_DRIFT_SQL = `
SELECT s.id,
       s."slotDate"::text AS "slotDate",
       s."startTime" AS "startTime",
       s."endTime" AS "endTime",
       s."lockedCount"::int AS "lockedCount",
       COUNT(o.id) FILTER (WHERE COALESCE(o."customFieldsSlotlocked", false))::int AS "ordersLocked",
       COUNT(o.id) FILTER (WHERE COALESCE(o."customFieldsSlotlocked", false)
                          AND o."state" = 'Cancelled')::int AS "cancelledLocked"
FROM delivery_slot s
LEFT JOIN "order" o ON o."customFieldsDeliveryslotid" = s.id::text
WHERE s."slotDate" BETWEEN current_date - 7 AND current_date + 7
GROUP BY s.id
HAVING s."lockedCount" <> COUNT(o.id) FILTER (WHERE COALESCE(o."customFieldsSlotlocked", false))
    OR COUNT(o.id) FILTER (WHERE COALESCE(o."customFieldsSlotlocked", false)
                          AND o."state" = 'Cancelled') > 0
`;
let SlotReconcileJob = SlotReconcileJob_1 = class SlotReconcileJob {
    constructor(connection, feishu, 
    /** M5 跨实例告警去重；未注入退回进程内 Map */
    dedupe) {
        this.connection = connection;
        this.feishu = feishu;
        this.dedupe = dedupe;
        this.fallback = null;
        /** 告警去重（24h；M5 经 dedupe 跨实例，未注入退回进程内 Map） */
        this.alertedAt = new Map();
    }
    start(intervalMs = 10 * 60000) {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({ name: 'slot-reconcile', intervalMs, loggerCtx: 'CampusSlot' });
        this.fallback.start(async () => {
            // 多实例互斥：拿不到锁说明其他实例正在对账，本轮直接跳过
            await (0, advisory_lock_1.withAdvisoryLock)(this.connection, 'campus:slot-reconcile', () => this.runOnce());
        });
    }
    onApplicationShutdown() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
    /** 执行一轮对账，返回偏差行（运维/单测可直接调用） */
    async runOnce(now = Date.now()) {
        var _a, _b, _c;
        const res = await this.connection.rawConnection.query(exports.SLOT_DRIFT_SQL);
        const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res);
        if (!Array.isArray(rows) || !rows.length)
            return [];
        for (const row of rows) {
            const slot = Number(row.id);
            const date = String(row.slotDate);
            const window = `${date} ${row.startTime}-${row.endTime}`;
            const locked = Number((_a = row.lockedCount) !== null && _a !== void 0 ? _a : 0);
            const orders = Number((_b = row.ordersLocked) !== null && _b !== void 0 ? _b : 0);
            const cancelled = Number((_c = row.cancelledLocked) !== null && _c !== void 0 ? _c : 0);
            common_1.Logger.warn(`锁位偏差 slot=${slot} ${window} lockedCount=${locked} ordersLocked=${orders} cancelledLocked=${cancelled}`, 'CampusSlot');
            if (locked > orders) {
                await this.alertOnce(now, `slot_reconcile:${slot}:${date}:over`, '锁位容量多计', `时段 ${window}：容量锁定 ${locked}，实际占位订单 ${orders}，多计 ${locked - orders} 个名额（疑似支付后进程中断），请人工核对。`);
            }
            else if (locked < orders) {
                await this.alertOnce(now, `slot_reconcile:${slot}:${date}:under`, '锁位容量少计', `时段 ${window}：容量锁定 ${locked}，实际占位订单 ${orders}，少计 ${orders - locked} 个名额（可能继续超卖），请立即核对。`);
            }
            if (cancelled > 0) {
                await this.alertOnce(now, `slot_reconcile:${slot}:${date}:cancel`, '锁位取消未释放', `时段 ${window}：有 ${cancelled} 单已取消但仍占用名额（取消时释放失败），请人工回收。`);
            }
        }
        return rows;
    }
    async alertOnce(now, key, title, text) {
        if (this.dedupe) {
            if (await this.dedupe.seenOrMark(key, SlotReconcileJob_1.ALERT_TTL_MS))
                return;
        }
        else {
            const last = this.alertedAt.get(key);
            if (last != null && now - last < SlotReconcileJob_1.ALERT_TTL_MS)
                return;
            this.alertedAt.set(key, now);
            // 清理过期键，避免长期运行后 Map 增长
            for (const [k, at] of this.alertedAt) {
                if (now - at >= SlotReconcileJob_1.ALERT_TTL_MS)
                    this.alertedAt.delete(k);
            }
        }
        await this.feishu.pushEvent('alert', title, text, undefined, key);
    }
};
exports.SlotReconcileJob = SlotReconcileJob;
SlotReconcileJob.ALERT_TTL_MS = 24 * 3600000;
exports.SlotReconcileJob = SlotReconcileJob = SlotReconcileJob_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        feishu_notify_service_1.FeishuNotifyService,
        campus_dedupe_service_1.CampusDedupeService])
], SlotReconcileJob);
//# sourceMappingURL=slot-reconcile.job.js.map