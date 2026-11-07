import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Channel, Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { businessDeadline } from './after-sales-sla';
import { dbNowWallToInstant } from './db-now-wall';
import { closureDateKeys } from './closure-calendar';
import { withAdvisoryLock } from './advisory-lock';
import { CampusConfigService } from './campus-config.service';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusAfterSalesSla';
/** 启动后首跑延迟：等迁移补 slaDeadlineAt 列 */
const BOOT_DELAY_MS = 60_000;
/** 重算周期：5 分钟，新售后单最迟 5 分钟内纳入营业时段口径 */
const INTERVAL_MS = 5 * 60_000;

/**
 * 售后 SLA 截止时间重算（§99）：把「申请时间 + 处理时限」换算成营业时段感知的截止时间，
 * 写入 after_sales_request.slaDeadlineAt，供列表筛选、工作台统计、处理人负载、报表统一使用。
 * - 未配置营业时间（或配置无法解析）时等价于申请时间 + 时限 + 暂停累计。
 * - 重算本身幂等，但多实例同跑会放大读写压力并重复读渠道配置，故仍以咨询锁串行化。
 */
@Injectable()
export class AfterSalesSlaDeadlineJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;

    constructor(private connection: TransactionalConnection, private config: CampusConfigService) {}

    start(): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'after-sales-sla-deadline',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() =>
            // 多实例互斥：拿不到锁说明其他实例正在重算，本轮直接跳过
            withAdvisoryLock(this.connection, 'campus:after-sales-sla-deadline', () => this.run()),
        );
    }

    stop(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    onApplicationShutdown(): void {
        this.stop();
    }

    async run(): Promise<void> {
        let channels: Channel[];
        try {
            channels = await this.connection.rawConnection.getRepository(Channel).find();
        } catch (e: any) {
            Logger.warn(`query channels failed: ${String(e?.message ?? e)}`, loggerCtx);
            return;
        }
        for (const channel of channels) {
            try {
                await this.runChannel(channel);
            } catch (e: any) {
                Logger.warn(`sla deadline failed for channel ${channel.code}: ${String(e?.message ?? e)}`, loggerCtx);
            }
        }
    }

    async runChannel(channel: Channel): Promise<void> {
        const cf = (channel.customFields ?? {}) as any;
        const businessHours = cf.waimaiBusinessHours ?? null;
        const timeoutHours = Number(cf.afterSalesTimeoutHours ?? 48);
        // §100：休业日整天不计入处理时限（含历史休业日，供跨假期工单按同一口径重算）
        const ctx = new RequestContext({ apiType: 'admin', channel, isAuthorized: true, authorizedAsOwnerOnly: false });
        let closureDates: string[] = [];
        try {
            closureDates = closureDateKeys((await this.config.getConfig(ctx))?.closureDates);
        } catch (e: any) {
            Logger.warn(`read closure dates failed for channel ${channel.code}: ${String(e?.message ?? e)}`, loggerCtx);
        }
        const raw = this.connection.rawConnection;
        const rows: any = await raw.query(
            `SELECT a.id, a."createdAt", COALESCE(a."slaPausedMs", 0) AS paused
               FROM after_sales_request a
              WHERE a.state IN ('Pending', 'Appealed')
                AND EXISTS (SELECT 1 FROM "order" o
                            JOIN order_channels_channel oc ON oc."orderId" = o.id
                            WHERE o.id = a."orderId" AND oc."channelId" = $1)`,
            [Number(channel.id)],
        );
        const list: any[] = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length) return;
        for (const r of list) {
            // 申请时间由 DB now() 写入（UTC 墙钟），必须还原为绝对时刻，否则截止时间整体提前 8 小时
            const deadline = businessDeadline(
                dbNowWallToInstant(r.createdAt),
                timeoutHours,
                businessHours,
                Number(r.paused),
                closureDates,
            );
            await raw.query(
                'UPDATE after_sales_request SET "slaDeadlineAt" = to_timestamp($2 / 1000.0) '
                + 'WHERE id = $1 AND "slaDeadlineAt" IS DISTINCT FROM to_timestamp($2 / 1000.0)',
                [Number(r.id), deadline],
            );
        }
    }
}
