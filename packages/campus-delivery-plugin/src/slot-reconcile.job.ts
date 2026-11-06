import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { withAdvisoryLock } from './advisory-lock';
import { CampusDedupeService } from './campus-dedupe.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { PeriodicFallback } from './periodic-fallback';

/** 单一时段对账行：容量锁定数与订单 slotLocked 数不一致 */
export interface SlotDriftRow {
    id: number;
    slotDate: string;
    startTime: string;
    endTime: string;
    lockedCount: number;
    ordersLocked: number;
    cancelledLocked: number;
}

/**
 * 锁位对账（R3）：只读比对 delivery_slot.lockedCount 与订单 customFields.slotLocked。
 * 崩溃窗（容量 +1 后进程退出）会形成「容量多计」幽灵占位；取消释放失败会留下「已取消仍占位」。
 * 仅告警、不自动改容量——先观测 2 周，确认偏差真实存在后再引入 claiming 中间态。
 */
export const SLOT_DRIFT_SQL = `
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

@Injectable()
export class SlotReconcileJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;
    /** 告警去重（24h；M5 经 dedupe 跨实例，未注入退回进程内 Map） */
    private alertedAt = new Map<string, number>();
    private static readonly ALERT_TTL_MS = 24 * 3600_000;

    constructor(
        private connection: TransactionalConnection,
        private feishu: FeishuNotifyService,
        /** M5 跨实例告警去重；未注入退回进程内 Map */
        private dedupe?: CampusDedupeService,
    ) {}

    start(intervalMs = 10 * 60_000): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({ name: 'slot-reconcile', intervalMs, loggerCtx: 'CampusSlot' });
        this.fallback.start(async () => {
            // 多实例互斥：拿不到锁说明其他实例正在对账，本轮直接跳过
            await withAdvisoryLock(this.connection, 'campus:slot-reconcile', () => this.runOnce());
        });
    }

    onApplicationShutdown(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    /** 执行一轮对账，返回偏差行（运维/单测可直接调用） */
    async runOnce(now = Date.now()): Promise<SlotDriftRow[]> {
        const res: any = await this.connection.rawConnection.query(SLOT_DRIFT_SQL);
        const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res) as SlotDriftRow[];
        if (!Array.isArray(rows) || !rows.length) return [];
        for (const row of rows) {
            const slot = Number(row.id);
            const date = String(row.slotDate);
            const window = `${date} ${row.startTime}-${row.endTime}`;
            const locked = Number(row.lockedCount ?? 0);
            const orders = Number(row.ordersLocked ?? 0);
            const cancelled = Number(row.cancelledLocked ?? 0);
            Logger.warn(
                `锁位偏差 slot=${slot} ${window} lockedCount=${locked} ordersLocked=${orders} cancelledLocked=${cancelled}`,
                'CampusSlot',
            );
            if (locked > orders) {
                await this.alertOnce(now, `slot_reconcile:${slot}:${date}:over`, '锁位容量多计',
                    `时段 ${window}：容量锁定 ${locked}，实际占位订单 ${orders}，多计 ${locked - orders} 个名额（疑似支付后进程中断），请人工核对。`);
            } else if (locked < orders) {
                await this.alertOnce(now, `slot_reconcile:${slot}:${date}:under`, '锁位容量少计',
                    `时段 ${window}：容量锁定 ${locked}，实际占位订单 ${orders}，少计 ${orders - locked} 个名额（可能继续超卖），请立即核对。`);
            }
            if (cancelled > 0) {
                await this.alertOnce(now, `slot_reconcile:${slot}:${date}:cancel`, '锁位取消未释放',
                    `时段 ${window}：有 ${cancelled} 单已取消但仍占用名额（取消时释放失败），请人工回收。`);
            }
        }
        return rows;
    }

    private async alertOnce(now: number, key: string, title: string, text: string): Promise<void> {
        if (this.dedupe) {
            if (await this.dedupe.seenOrMark(key, SlotReconcileJob.ALERT_TTL_MS)) return;
        } else {
            const last = this.alertedAt.get(key);
            if (last != null && now - last < SlotReconcileJob.ALERT_TTL_MS) return;
            this.alertedAt.set(key, now);
            // 清理过期键，避免长期运行后 Map 增长
            for (const [k, at] of this.alertedAt) {
                if (now - at >= SlotReconcileJob.ALERT_TTL_MS) this.alertedAt.delete(k);
            }
        }
        await this.feishu.pushEvent('alert', title, text, undefined, key);
    }
}
