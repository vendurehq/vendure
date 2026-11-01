import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Channel, Logger, Order, TransactionalConnection } from '@vendure/core';
import { campusDayKey, startOfCampusDay } from './campus-time';
import { FeishuClient } from './feishu/feishu.client';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusDailyReport';
/** 启动后首跑延迟：等迁移补 Channel 自定义字段与 DB 连接稳定 */
const BOOT_DELAY_MS = 60_000;
/** 检查周期：30 分钟；日报只在跨过设定时刻的那一轮推一次 */
const INTERVAL_MS = 30 * 60_000;
/** 默认推送时间 21:30 */
const DEFAULT_TIME = '21:30';
const DAY_MS = 24 * 3600_000;
/** 单日失败重试上限（§118）：满 3 次放弃，次日 0 点自然重置 */
const MAX_ATTEMPTS = 3;

interface Report {
    orders: number;
    gross: number;
    avgTicket: number;
    peakHour: number | null;
    peakOrders: number;
    top: Array<{ name: string; qty: number }>;
}

/**
 * 商家每日日报推送（§86）：店铺开启后，每天到设定时间（默认 21:30）把「昨日报表」推到店铺群。
 * - 口径与经营设置页「今日/近 7 日」一致：deliveryStatus='delivered' 按 deliveredAt 归日，取消单不计入。
 * - 幂等：Channel.waimaiDailyPushLastDate 记已推送的校园日；同一天只推一条，改时间不会重复推。
 * - 未启用 / 未到点 / 今日已推过 都跳过；推送失败只告警不写 lastDate，下一轮重试。
 * - 重试上限（§118）：同一渠道同一天失败满 3 次即放弃（保留 lastDate 不写），次日重新计次。
 * - 渠道间用咨询锁隔离，多实例部署不重复推送。
 */
@Injectable()
export class DailyReportPushJob implements OnApplicationShutdown {
    private fallback: PeriodicFallback | null = null;
    /** 当日失败计数（§118）：channelId → { 校园日, 次数 }；仅进程内，多实例各自计次 */
    private attempts = new Map<number, { day: string; n: number }>();

    constructor(
        private connection: TransactionalConnection,
        private feishu: FeishuClient,
    ) {}

    start(): void {
        if (this.fallback) return;
        this.fallback = new PeriodicFallback({
            name: 'daily-report-push',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() => this.run());
    }

    stop(): void {
        this.fallback?.stop();
        this.fallback = null;
    }

    onApplicationShutdown(): void {
        this.stop();
    }

    /** 扫描全部启用了日报推送的渠道（未配置飞书发送能力时整体跳过，避免空转） */
    async run(): Promise<void> {
        if (!this.feishu.enabled) return;
        const channels = await this.connection.rawConnection
            .getRepository(Channel)
            .createQueryBuilder('channel')
            .where('channel.customFields.waimaiDailyPushEnabled = :on', { on: true })
            .getMany();
        for (const channel of channels) {
            try {
                await this.runChannelWithLock(Number(channel.id));
            } catch (e: any) {
                Logger.error(`daily report push failed for channel ${channel.id}: ${e?.message}`, loggerCtx);
            }
        }
    }

    private async runChannelWithLock(channelId: number): Promise<void> {
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:dailyreport:${channelId}`;
        try {
            const got: any = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!rows?.[0]?.ok) return;
            try {
                await this.runChannel(channelId);
            } finally {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
            }
        } finally {
            await runner.release();
        }
    }

    async runChannel(channelId: number): Promise<void> {
        const repo = this.connection.rawConnection.getRepository(Channel);
        const channel = await repo.findOne({ where: { id: channelId } as any });
        if (!channel) return;
        const cf = (channel.customFields ?? {}) as any;
        if (!cf.waimaiDailyPushEnabled) return;
        const pushTime = this.normalizeTime(cf.waimaiDailyPushTime);
        const now = Date.now();
        const todayKey = campusDayKey(now);
        // 幂等键按「推送日」记：同一天只推一条
        if (cf.waimaiDailyPushLastDate === todayKey) return;
        const dueAt = startOfCampusDay(now) + this.minutesOf(pushTime) * 60_000;
        if (now < dueAt) return;
        // 重试上限（§118）：当日已失败 3 次则不再尝试，避免坏配置整夜重复请求推送接口
        const prev = this.attempts.get(channelId);
        const attempts = prev && prev.day === todayKey ? prev.n : 0;
        if (attempts >= MAX_ATTEMPTS) return;

        const report = await this.buildReport(channelId, now);
        const text = this.renderText(channel.code, report, campusDayKey(startOfCampusDay(now) - DAY_MS));
        const reasonOut = { reason: '' };
        const ok = await this.feishu.broadcast(text, { channel: channel.code, reasonOut });
        if (!ok) {
            const n = attempts + 1;
            this.attempts.set(channelId, { day: todayKey, n });
            // §119 失败原因落库：设置页展示「上次推送失败 时间 + 原因」，成功推送后清空
            const reason = (reasonOut.reason || '推送失败（未知原因）').slice(0, 200);
            await this.connection.rawConnection
                .query(
                    'UPDATE "channel" SET "customFieldsWaimaidailypushlastfailat" = $1, "customFieldsWaimaidailypushlastfailreason" = $2 WHERE id = $3',
                    [String(now), reason, channelId],
                )
                .catch((e: any) => Logger.warn(`daily report fail state not saved: ${e?.message}`, loggerCtx));
            if (n >= MAX_ATTEMPTS) {
                Logger.error(
                    `daily report retry limit reached (channel ${channel.code}, ${n}/${MAX_ATTEMPTS} today, reason: ${reason}); give up until next day`,
                    loggerCtx,
                );
            } else {
                Logger.warn(
                    `daily report not delivered (channel ${channel.code}, attempt ${n}/${MAX_ATTEMPTS}, reason: ${reason}), retry next round`,
                    loggerCtx,
                );
            }
            return;
        }
        // 成功后清空当日计次（次日从 0 开始）
        this.attempts.delete(channelId);
        const fresh = await repo.findOne({ where: { id: channelId } as any });
        if (fresh) {
            (fresh.customFields as any).waimaiDailyPushLastDate = todayKey;
            await repo.save(fresh);
        }
        // 成功即抹掉历史失败标记（§119），避免设置页继续显示过期失败
        await this.connection.rawConnection
            .query(
                'UPDATE "channel" SET "customFieldsWaimaidailypushlastfailat" = NULL, "customFieldsWaimaidailypushlastfailreason" = NULL WHERE id = $1',
                [channelId],
            )
            .catch(() => undefined);
        Logger.info(`daily report pushed for channel ${channel.code} (${report.orders} orders)`, loggerCtx);
    }

    /** 昨日日报（校园时区自然日；口径同经营设置页 revenue：deliveredAt 归日） */
    private async buildReport(channelId: number, now: number): Promise<Report> {
        const today0 = startOfCampusDay(now);
        const orders = await this.connection.rawConnection.getRepository(Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: channelId as any })
            .andWhere("order.customFields.deliveryStatus = 'delivered'")
            .andWhere('order.customFields.deliveredAt >= :from', { from: new Date(today0 - DAY_MS) })
            .andWhere('order.customFields.deliveredAt < :to', { to: new Date(today0) })
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .getMany();
        const gross = orders.reduce((s, o) => s + Number(o.totalWithTax ?? 0), 0);
        const hourMap = new Map<number, number>();
        for (const o of orders) {
            const h = this.campusHourOf((o.customFields as any).deliveredAt);
            if (h !== null) hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
        }
        let peakHour: number | null = null;
        let peakOrders = 0;
        for (const [h, n] of hourMap) {
            if (n > peakOrders) {
                peakHour = h;
                peakOrders = n;
            }
        }
        // 热销前 5：按订单行数量汇总，商品名取变体英文翻译名（与菜单一致）
        const qtyMap = new Map<string, { name: string; qty: number }>();
        for (const o of orders) {
            for (const line of o.lines ?? []) {
                const name = line.productVariant?.name ?? `商品 #${line.productVariantId}`;
                const cur = qtyMap.get(name) ?? { name, qty: 0 };
                cur.qty += Number(line.quantity ?? 0);
                qtyMap.set(name, cur);
            }
        }
        const top = Array.from(qtyMap.values())
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);
        return {
            orders: orders.length,
            gross,
            avgTicket: orders.length ? Math.round(gross / orders.length) : 0,
            peakHour,
            peakOrders,
            top,
        };
    }

    /** 文本日报：金额分转元；无数据的行整行省略，避免「—」噪声 */
    private renderText(code: string, r: Report, reportDay: string): string {
        const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
        const lines = [
            `【${code}】${reportDay} 经营日报`,
            `完成单量：${r.orders} 单`,
            `营业额：${yuan(r.gross)}（客单价 ${yuan(r.avgTicket)}）`,
        ];
        if (r.peakHour !== null) lines.push(`高峰时段：${r.peakHour}:00-${r.peakHour + 1}:00（${r.peakOrders} 单）`);
        if (r.top.length) lines.push(`热销前 5：${r.top.map((t, i) => `${i + 1}. ${t.name}×${t.qty}`).join('；')}`);
        if (!r.orders) lines.push('昨日无完成订单，可检查营业时间与休业日历设置。');
        return lines.join('\n');
    }

    /** 'HH:MM' 归一；为空/非法按 21:30（写入口已校验，这里只做兜底） */
    private normalizeTime(v: unknown): string {
        const s = String(v ?? '').trim();
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : DEFAULT_TIME;
    }

    private minutesOf(v: string): number {
        const [h, m] = v.split(':').map(Number);
        return h * 60 + m;
    }

    /** 校园时区（UTC+8）小时 0-23，无效时间返回 null */
    private campusHourOf(v: unknown): number | null {
        if (v === null || v === undefined) return null;
        const d = new Date(v as any);
        if (Number.isNaN(d.getTime())) return null;
        return new Date(d.getTime() + 8 * 3600_000).getUTCHours();
    }
}
