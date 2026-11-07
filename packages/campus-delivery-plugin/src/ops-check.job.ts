import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { campusDayKey } from './campus-time';
import { campusHhmm } from './feishu/feishu.digest.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { PeriodicFallback } from './periodic-fallback';
import { SLOT_DRIFT_SQL } from './slot-reconcile.job';

interface CheckMetric {
    label: string;
    count: number;
}

/** 各履约状态桶的滞留时长 P95（分钟），仅日志输出，帮助判断积压是否长期化 */
// 口径：customFieldsHallenteredat 是 timestamptz（绝对时刻）；createdAt 是 timestamp + DB now()（UTC 墙钟）。
// 列已归一为 timestamptz：createdAt 直接参与 now() 差值，不再依赖会话 TimeZone。
const BACKLOG_P95_SQL = `
SELECT "customFieldsHallstatus" AS bucket,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (now() - COALESCE("customFieldsHallenteredat", "createdAt")) / 60
       ), 0)::int AS p95_min,
       COUNT(*)::int AS n
FROM "order"
WHERE "state" <> 'Cancelled'
  AND "customFieldsHallstatus" IN ('open', 'accepted', 'pending_merchant', 'pending_dispatch', 'owned_pool', 'third_party')
GROUP BY 1
`;

/**
 * R8 遗留巡检（默认每日 09:00，UTC+8）：把「会静默卡住」的残留量汇总推送到平台群。
 * 全部指标为只读 COUNT；任一查询失败记为 -1 并跳过该项，不影响其余指标。
 * 多实例安全：PG advisory lock + 进程内按天去重（与飞书汇总同模式）。
 */
@Injectable()
export class OpsCheckJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;
    private sentDay: string | null = null;
    /** 巡检时间（HH:mm，UTC+8），默认 09:00 */
    private readonly at = process.env.CAMPUS_OPS_CHECK_AT || '09:00';

    constructor(
        private connection: TransactionalConnection,
        private feishu: FeishuNotifyService,
    ) {}

    start(intervalMs = 30 * 60_000): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({ name: 'ops-check', intervalMs, loggerCtx: 'CampusOpsCheck' });
        this.fallback.start(async () => {
            await this.runOnce();
        });
    }

    onApplicationShutdown(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    /** 执行一次巡检；已过巡检时间且当日未发送时推送，返回推送文本（未触发/全为零返回 null） */
    async runOnce(now = Date.now()): Promise<string | null> {
        if (campusHhmm(now) < this.at) return null;
        const day = campusDayKey(now);
        if (this.sentDay === day) return null;

        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:ops-check:${day}`;
        try {
            const got: any = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!rows?.[0]?.ok) return null; // 其他实例正在/已执行
            try {
                if (this.sentDay === day) return null;
                const metrics = await this.collect();
                const abnormal = metrics.filter(m => m.count > 0);
                this.sentDay = day;
                if (!abnormal.length) return null;
                const text = `遗留巡检 ${day}\n${abnormal.map(m => `${m.label}：${m.count}`).join('\n')}`;
                await this.feishu.pushEvent('alert', `遗留巡检 ${day}`, text, undefined, `ops_check:${day}`);
                return text;
            } finally {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
            }
        } finally {
            await runner.release();
        }
    }

    private async collect(): Promise<CheckMetric[]> {
        const count = async (sql: string): Promise<number> => {
            try {
                const r: any = await this.connection.rawConnection.query(sql);
                const n = Array.isArray(r) && Array.isArray(r[0]) ? r[0][0]?.n : r?.[0]?.n;
                return Number(n ?? 0);
            } catch (e: any) {
                Logger.warn(`巡检查询失败：${e?.message ?? e}`, 'CampusOpsCheck');
                return -1;
            }
        };
        const [
            withdraw,
            refund,
            thirdParty,
            compFailed,
            compOverdue,
            slotDrift,
            notifyFallback,
            thirdPartyLong,
            compFailedLong,
            ticketUnassigned,
            ticketStaleAssigned,
        ] = await Promise.all([
            count(
                `SELECT COUNT(*)::int AS n FROM rider_withdrawal_request
                 WHERE "withdrawState" = 'intent' AND "createdAt" < now() - interval '10 minutes'`,
            ),
            count(`SELECT COUNT(*)::int AS n FROM "order" WHERE "customFieldsHallstatus" = 'refund_failed'`),
            count(`SELECT COUNT(*)::int AS n FROM "order" WHERE "customFieldsThirdpartystate" = 'exception'`),
            count(`SELECT COUNT(*)::int AS n FROM campus_compensation_task WHERE status = 'failed'`),
            count(
                `SELECT COUNT(*)::int AS n FROM campus_compensation_task
                 WHERE status = 'pending' AND "nextAttemptAt" < now() - interval '30 minutes'`,
            ),
            // R3：锁位容量与实际占位订单不一致的时段数（明细由 SlotReconcileJob 实时告警）
            count(`SELECT COUNT(*)::int AS n FROM (${SLOT_DRIFT_SQL}) drift`),
            // R6：模板不可用走兜底的当日次数（超过阈值才计入巡检，避免零星兜底天天告警）
            count(
                `SELECT COUNT(*)::int AS n FROM campus_track_event
                 WHERE "eventName" = 'notify_delivery' AND "createdAt" >= current_date`,
            ),
            // 长尾：外部运力异常超 24h 仍未处置（工单关闭会回写 exceptionResolvedAt）
            count(
                `SELECT COUNT(*)::int AS n FROM "order"
                 WHERE "customFieldsThirdpartystate" = 'exception'
                   AND "customFieldsExceptionresolvedat" IS NULL
                   AND "createdAt" < now() - interval '24 hours'`,
            ),
            // 长尾：补偿任务失败超 7 天（管理端可一键重试，超 30 天只提供归档 SQL）
            count(
                `SELECT COUNT(*)::int AS n FROM campus_compensation_task
                 WHERE status = 'failed' AND "createdAt" < now() - interval '7 days'`,
            ),
            // 长尾：系统工单 24h 未指派（值班自动指派失败/无值班表时的兜底可见）
            count(
                `SELECT COUNT(*)::int AS n FROM campus_support_ticket
                 WHERE status = 'open' AND "assigneeId" IS NULL AND "createdAt" < now() - interval '24 hours'`,
            ),
            // 长尾：已指派但 48h 仍未关闭（处理人失联或忘记回复）
            count(
                `SELECT COUNT(*)::int AS n FROM campus_support_ticket
                 WHERE status = 'open' AND "assigneeId" IS NOT NULL AND "createdAt" < now() - interval '48 hours'`,
            ),
        ]);
        await this.logBacklogP95();
        const metrics: CheckMetric[] = [
            { label: '提现扣款意图滞留', count: withdraw },
            { label: '退款失败待人工', count: refund },
            { label: '外部运力异常', count: thirdParty },
            { label: '补偿任务失败', count: compFailed },
            { label: '补偿任务超期未执行', count: compOverdue },
            { label: '锁位时段偏差', count: slotDrift },
            { label: '外部异常超 24h 未处置', count: thirdPartyLong },
            { label: '补偿失败超 7 天', count: compFailedLong },
            { label: '系统工单 24h 未指派', count: ticketUnassigned },
            { label: '系统工单已指派 48h 未关闭', count: ticketStaleAssigned },
        ];
        const notifyThreshold = Math.max(1, Number(process.env.CAMPUS_NOTIFY_FALLBACK_ALERT ?? 20) || 20);
        if (notifyFallback >= notifyThreshold) {
            metrics.push({ label: '通知兜底（今日）', count: notifyFallback });
        }
        return metrics;
    }

    /** 积压滞留 P95：只写日志（不进入每日推送），用于评估各状态桶是否长期滞留 */
    private async logBacklogP95(): Promise<void> {
        try {
            const r: any = await this.connection.rawConnection.query(BACKLOG_P95_SQL);
            const rows = Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r;
            if (!Array.isArray(rows) || !rows.length) return;
            const text = rows
                .map((x: any) => `${x.bucket ?? '-'}:P95 ${Number(x.p95_min ?? 0)}min/${Number(x.n ?? 0)}单`)
                .join('，');
            Logger.log(`积压滞留 P95：${text}`, 'CampusOpsCheck');
        } catch (e: any) {
            Logger.warn(`积压 P95 查询失败：${e?.message ?? e}`, 'CampusOpsCheck');
        }
    }
}
