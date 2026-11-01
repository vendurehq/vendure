import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Channel, EventBus, Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { AfterSalesMerchantNotifyEvent } from '@vendure/after-sales-plugin';
import { withAdvisoryLock } from './advisory-lock';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusAfterSalesFollowUp';
/** 启动后首跑延迟：等迁移补列 / DB 连接稳定 */
const BOOT_DELAY_MS = 120_000;
/** 扫描周期：10 分钟（回访计划按小时级精度即可） */
const INTERVAL_MS = 10 * 60_000;
/** 单轮最多处理条数，防止异常积压拖慢进程 */
const MAX_PER_RUN = 200;

/**
 * 顾客回访到期提醒（§95）：扫描 campus_after_sales_followup 中 nextAt 已到、
 * 且该售后单之后没有更新回访记录的条目，一次性标记 remindedAt 并经事件提醒商家。
 * - 以「最新一条回访」为准：商家补录了新回访（nextAt 改期）后，旧计划自动失效。
 * - 提醒写入失败的风险由幂等标记兜底：每轮最多提醒一次，避免同一计划反复刷屏。
 */
@Injectable()
export class AfterSalesFollowUpRemindJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;

    constructor(private connection: TransactionalConnection, private eventBus: EventBus) {}

    start(): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'after-sales-followup-remind',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() =>
            // 多实例互斥：拿不到锁说明其他实例正在扫描，本轮直接跳过（避免回访提醒重复推送）
            withAdvisoryLock(this.connection, 'campus:after-sales-followup-remind', () => this.runOnce()),
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
                `SELECT f.id AS "followUpId", f."requestId" AS "requestId",
                        f."channelId" AS "channelId", f."nextAt" AS "nextAt"
                   FROM campus_after_sales_followup f
                   JOIN after_sales_request a ON a.id = f."requestId"
                  WHERE f."nextAt" IS NOT NULL AND f."nextAt" <= now() AND f."remindedAt" IS NULL
                    AND NOT EXISTS (SELECT 1 FROM campus_after_sales_followup f2
                                    WHERE f2."requestId" = f."requestId" AND f2."createdAt" > f."createdAt")
                  ORDER BY f."nextAt" ASC
                  LIMIT ${MAX_PER_RUN}`,
            );
        } catch (e: any) {
            // 表/列缺失（迁移未跑完）时本轮跳过，不阻断后续轮次
            Logger.warn(`query due follow-ups failed: ${String(e?.message ?? e)}`, loggerCtx);
            return;
        }
        const list: any[] = this.rows(rows);
        if (!list.length) return;

        const channelCache = new Map<number, Channel | null>();
        let sent = 0;
        for (const r of list) {
            const channelId = Number(r.channelId);
            try {
                if (!channelCache.has(channelId)) {
                    channelCache.set(
                        channelId,
                        await raw.getRepository(Channel).findOne({ where: { id: channelId } as any }),
                    );
                }
                const channel = channelCache.get(channelId);
                if (!channel) continue;
                // 先抢占再通知：同一计划只提醒一次（并发实例下由唯一更新兜底）
                const claimed: any = await raw.query(
                    'UPDATE campus_after_sales_followup SET "remindedAt" = now() '
                    + 'WHERE id = $1 AND "remindedAt" IS NULL RETURNING id',
                    [Number(r.followUpId)],
                );
                if (!this.rows(claimed).length) continue;
                const ctx = new RequestContext({
                    apiType: 'admin',
                    channel,
                    isAuthorized: true,
                    authorizedAsOwnerOnly: false,
                });
                const dueText = this.formatDue(r.nextAt);
                this.eventBus.publish(new AfterSalesMerchantNotifyEvent(
                    ctx,
                    Number(r.requestId),
                    '顾客回访到期',
                    `售后单 #${r.requestId} 的回访计划已到期（${dueText}），请及时跟进。`,
                ));
                sent += 1;
            } catch (e: any) {
                Logger.warn(`remind follow-up ${r.followUpId} failed: ${String(e?.message ?? e)}`, loggerCtx);
            }
        }
        if (sent > 0) Logger.info(`sent ${sent} after-sales follow-up reminder(s)`, loggerCtx);
    }

    /** 校园时区（UTC+8）展示：MM-DD HH:mm */
    private formatDue(v: unknown): string {
        const d = new Date(v as any);
        if (Number.isNaN(d.getTime())) return '已到期';
        const shifted = new Date(d.getTime() + 8 * 3600_000);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} `
            + `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
    }

    /** 兼容不同驱动的返回结构：部分驱动把结果再包一层数组 */
    private rows(result: any): any[] {
        if (!Array.isArray(result)) return [];
        return Array.isArray(result[0]) ? result[0] : result;
    }
}
