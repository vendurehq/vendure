import { OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { CampusDedupeService } from './campus-dedupe.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
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
export declare const SLOT_DRIFT_SQL = "\nSELECT s.id,\n       s.\"slotDate\"::text AS \"slotDate\",\n       s.\"startTime\" AS \"startTime\",\n       s.\"endTime\" AS \"endTime\",\n       s.\"lockedCount\"::int AS \"lockedCount\",\n       COUNT(o.id) FILTER (WHERE COALESCE(o.\"customFieldsSlotlocked\", false))::int AS \"ordersLocked\",\n       COUNT(o.id) FILTER (WHERE COALESCE(o.\"customFieldsSlotlocked\", false)\n                          AND o.\"state\" = 'Cancelled')::int AS \"cancelledLocked\"\nFROM delivery_slot s\nLEFT JOIN \"order\" o ON o.\"customFieldsDeliveryslotid\" = s.id::text\nWHERE s.\"slotDate\" BETWEEN current_date - 7 AND current_date + 7\nGROUP BY s.id\nHAVING s.\"lockedCount\" <> COUNT(o.id) FILTER (WHERE COALESCE(o.\"customFieldsSlotlocked\", false))\n    OR COUNT(o.id) FILTER (WHERE COALESCE(o.\"customFieldsSlotlocked\", false)\n                          AND o.\"state\" = 'Cancelled') > 0\n";
export declare class SlotReconcileJob implements OnApplicationShutdown {
    private connection;
    private feishu;
    /** M5 跨实例告警去重；未注入退回进程内 Map */
    private dedupe?;
    private fallback;
    /** 告警去重（24h；M5 经 dedupe 跨实例，未注入退回进程内 Map） */
    private alertedAt;
    private static readonly ALERT_TTL_MS;
    constructor(connection: TransactionalConnection, feishu: FeishuNotifyService, 
    /** M5 跨实例告警去重；未注入退回进程内 Map */
    dedupe?: CampusDedupeService | undefined);
    start(intervalMs?: number): void;
    onApplicationShutdown(): void;
    /** 执行一轮对账，返回偏差行（运维/单测可直接调用） */
    runOnce(now?: number): Promise<SlotDriftRow[]>;
    private alertOnce;
}
