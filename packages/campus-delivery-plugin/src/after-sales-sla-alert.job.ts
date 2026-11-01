import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Channel, EventBus, Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { AfterSalesMerchantNotifyEvent } from '@vendure/after-sales-plugin';
import { withAdvisoryLock } from './advisory-lock';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusAfterSalesSlaAlert';
/** 启动后首跑延迟：等迁移建表 / DB 连接稳定 */
const BOOT_DELAY_MS = 120_000;
/** 扫描周期：10 分钟（临期/超时按小时级变化，无需更密） */
const INTERVAL_MS = 10 * 60_000;
/** 同一售后单同类提醒的冷却：24h，避免超时单反复刷屏 */
const RENOTIFY_MS = 24 * 3600_000;
/** 单轮最多处理条数，防止异常积压拖慢进程 */
const MAX_PER_RUN = 200;
/** 渠道未配置时的兜底口径（与售后插件规则默认一致） */
const DEFAULT_TIMEOUT_HOURS = 48;
const DEFAULT_DUE_SOON_HOURS = 12;

/**
 * 售后 SLA 自动提醒（§90）：扫描本店 Pending 售后单，
 * 临期（剩余不足渠道阈值）与已超时各提醒一次，24h 内不重复。
 * 经 AfterSalesMerchantNotifyEvent 解耦，未装 notification-plugin 时仅无提醒。
 */
@Injectable()
export class AfterSalesSlaAlertJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;

    constructor(private connection: TransactionalConnection, private eventBus: EventBus) {}

    start(): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'after-sales-sla-alert',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() =>
            // 多实例互斥：拿不到锁说明其他实例正在扫描，本轮直接跳过（避免同一售后单并发提醒）
            withAdvisoryLock(this.connection, 'campus:after-sales-sla-alert', () => this.runOnce()),
        );
    }

    stop(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    onApplicationShutdown(): void {
        this.stop();
    }

    async runOnce(): Promise<void> {
        const raw = this.connection.rawConnection;
        let rows: any;
        try {
            rows = await raw.query(
                `SELECT a.id AS "requestId", oc."channelId" AS "channelId",
                        a."createdAt" AS "createdAt",
                        COALESCE(a."slaPausedMs", 0) AS "slaPausedMs"
                   FROM after_sales_request a
                   JOIN "order" o ON o.id = a."orderId"
                   JOIN order_channels_channel oc ON oc."orderId" = o.id
                  WHERE a.state = 'Pending' AND a."slaPausedAt" IS NULL AND o."customFieldsHallstatus" IS NOT NULL
                  ORDER BY a."createdAt" ASC
                  LIMIT ${MAX_PER_RUN}`,
            );
        } catch (e: any) {
            // 表/列缺失（迁移未跑完）时本轮跳过，不阻断后续轮次
            Logger.warn(`query pending after-sales failed: ${String(e?.message ?? e)}`, loggerCtx);
            return;
        }
        const list: any[] = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length) return;

        const now = Date.now();
        const channelCache = new Map<number, Channel | null>();
        let sent = 0;
        for (const r of list) {
            try {
                // 阈值改从渠道实体读（原裸 SQL 拼 channel 自定义字段列名，生产列名大小写与预期不符导致整轮查询失败）
                const channelId = Number(r.channelId);
                if (!channelCache.has(channelId)) {
                    channelCache.set(
                        channelId,
                        await raw.getRepository(Channel).findOne({ where: { id: channelId } as any }),
                    );
                }
                const channel = channelCache.get(channelId);
                if (!channel) continue;
                const cf = (channel.customFields ?? {}) as any;
                // 与商家端「售后规则」同源：未配置按 48h / 12h；0 = 关闭该类提醒
                const timeoutHours = Number(cf.afterSalesTimeoutHours ?? DEFAULT_TIMEOUT_HOURS) || DEFAULT_TIMEOUT_HOURS;
                const dueSoonHours = Number(cf.afterSalesDueSoonHours ?? DEFAULT_DUE_SOON_HOURS) || 0;
                const createdAt = new Date(r.createdAt).getTime();
                // §95：已累计暂停时长顺延截止时间
                const deadline = createdAt + timeoutHours * 3600_000 + (Number(r.slaPausedMs) || 0);
                const kind = now >= deadline
                    ? 'overdue'
                    : (dueSoonHours > 0 && deadline - now <= dueSoonHours * 3600_000 ? 'dueSoon' : null);
                if (!kind) continue;
                const claimed: any = await raw.query(
                    `INSERT INTO campus_after_sales_sla_alert ("channelId", "requestId", "kind", "alertedAt")
                     VALUES ($1, $2, $3, now())
                     ON CONFLICT ("requestId", "kind") DO UPDATE SET "alertedAt" = now()
                      WHERE campus_after_sales_sla_alert."alertedAt" < now() - interval '${Math.floor(RENOTIFY_MS / 3600_000)} hours'
                     RETURNING "requestId"`,
                    [channelId, Number(r.requestId), kind],
                );
                const claimedList: any[] = Array.isArray(claimed) && Array.isArray(claimed[0]) ? claimed[0] : claimed;
                if (!Array.isArray(claimedList) || !claimedList.length) continue;
                const ctx = new RequestContext({
                    apiType: 'admin',
                    channel,
                    isAuthorized: true,
                    authorizedAsOwnerOnly: false,
                });
                const title = kind === 'overdue' ? '售后已超时' : '售后即将超时';
                const content = kind === 'overdue'
                    ? `售后单 #${r.requestId} 已超过处理时限（${timeoutHours} 小时），请尽快处理。`
                    : `售后单 #${r.requestId} 即将超过处理时限（${timeoutHours} 小时），请及时处理。`;
                this.eventBus.publish(new AfterSalesMerchantNotifyEvent(ctx, Number(r.requestId), title, content));
                sent += 1;
            } catch (e: any) {
                Logger.warn(`alert request ${r.requestId} failed: ${String(e?.message ?? e)}`, loggerCtx);
            }
        }
        if (sent > 0) Logger.info(`sent ${sent} after-sales SLA alert(s)`, loggerCtx);
    }
}
