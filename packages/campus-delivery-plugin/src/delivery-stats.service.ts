import { Injectable } from '@nestjs/common';
import { Logger, Order, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusFulfillmentConfig } from './campus-fulfillment-config.entity';
import { campusDayKey, campusHour, startOfCampusDay } from './campus-time';

export type StatsRange = 'today' | '7d' | '30d';

const RANGE_MS: Record<Exclude<StatsRange, 'today'>, number> = {
    '7d': 7 * 24 * 3600_000,
    '30d': 30 * 24 * 3600_000,
};
const DEFAULT_GRACE_MIN = 10;
const DEFAULT_CHANNEL_CODE = '__default_channel__';

export interface StatsOrderLike {
    id: unknown;
    code: string;
    state: string;
    createdAt: Date | string;
    channels?: Array<{ id: unknown; code: string; customFields?: { shopName?: string | null } | null }>;
    customFields: {
        promisedAt?: Date | string | null;
        assignedAt?: Date | string | null;
        deliveredAt?: Date | string | null;
        scheduledFor?: Date | string | null;
        timeoutCompensatedAt?: Date | string | null;
        timeoutAttribution?: string | null;
    };
}

export interface StatsKpi {
    totalOrders: number;
    onTimeRate: number;
    avgDeliveryMinutes: number;
    timeoutCompensated: number;
}

export interface StatsDailyPoint {
    date: string;
    orders: number;
    onTimeRate: number;
}

export interface StatsStage {
    key: 'assign' | 'transit';
    label: string;
    avgMinutes: number;
}

export interface StatsAttribution {
    merchant: number;
    rider: number;
    platform: number;
}

export interface StatsStoreLine {
    channelId: string;
    channelName: string;
    orders: number;
    onTimeRate: number;
}

export interface DeliveryStatsPayload {
    range: StatsRange;
    windowStart: Date;
    kpis: StatsKpi;
    dailyTrend: StatsDailyPoint[];
    stages: StatsStage[];
    attribution: StatsAttribution;
    storeComparison: StatsStoreLine[];
}

export function normalizeRange(v?: string | null): StatsRange {
    return v === 'today' || v === '30d' ? v : '7d';
}

/** 窗口起点：today=校园时区（UTC+8）0 点；7d/30d=滚动窗口 */
export function windowStartOf(range: StatsRange, now: number): number {
    if (range === 'today') {
        return startOfCampusDay(now);
    }
    return now - RANGE_MS[range];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const minOf = (ms: number) => round1(ms / 60_000);
const rateOf = (onTime: number, scored: number) => (scored > 0 ? round1((onTime / scored) * 100) : 0);

function dayKeyOf(d: Date): string {
    return campusDayKey(d.getTime());
}

/** 纯函数聚合（单测注入时间/数据）。
 * 口径：单量=窗口内未取消订单；准点率=deliveredAt ≤ promisedAt + 各渠道 grace（有承诺且已送达才计分）；
 * 平均送达/在途段=assignedAt→deliveredAt；接单段=createdAt→assignedAt；
 * 赔付=窗口内 timeoutCompensatedAt 非空单，按 timeoutAttribution 归因分桶；
 * 店铺对比=按渠道分组（排除平台默认渠道）。 */
export function aggregateStats(args: {
    orders: StatsOrderLike[];
    graceByChannel: Map<number, number>;
    windowStart: number;
    now: number;
    range: StatsRange;
}): DeliveryStatsPayload {
    const { orders: rawOrders, graceByChannel, windowStart, now, range } = args;
    // 口径内聚：取消单不计任何指标（双保险，service 层 SQL 已过滤）
    const orders = rawOrders.filter(o => o.state !== 'Cancelled');

    interface Bucket { orders: number; onTime: number; scored: number }
    const buckets = new Map<string, Bucket>();
    const stores = new Map<number, { name: string; orders: number; onTime: number; scored: number }>();

    let assignSum = 0, assignN = 0, transitSum = 0, transitN = 0;
    let compensated = 0, scoredTotal = 0, onTimeTotal = 0;
    const attribution: StatsAttribution = { merchant: 0, rider: 0, platform: 0 };

    const bucketOf = (t: number): Bucket => {
        let key: string;
        if (range === 'today') {
            key = `${campusHour(t)}`.padStart(2, '0') + ':00';
        } else {
            key = dayKeyOf(new Date(t));
        }
        let b = buckets.get(key);
        if (!b) { b = { orders: 0, onTime: 0, scored: 0 }; buckets.set(key, b); }
        return b;
    };

    for (const o of orders) {
        const cf = (o.customFields ?? {}) as StatsOrderLike['customFields'];
        const ch = (o.channels ?? []).find(c => c.code !== DEFAULT_CHANNEL_CODE) ?? (o.channels ?? [])[0];
        const chId = ch ? Number(ch.id) : 0;
        const grace = (graceByChannel.get(chId) ?? DEFAULT_GRACE_MIN) * 60_000;
        // order.createdAt 是 DB now() 写入的 UTC 墙钟，按桶归档/接单时长前先还原成绝对时刻
        const createdAt = toMs(o.createdAt);

        bucketOf(createdAt).orders++;

        const chName = ch?.customFields?.shopName || ch?.code || `channel-${chId}`;
        let store = stores.get(chId);
        if (!store) {
            store = { name: chName, orders: 0, onTime: 0, scored: 0 };
            stores.set(chId, store);
        }
        store.orders++;

        // 准点计分（仅既有承诺又有送达的单）
        if (cf.promisedAt && cf.deliveredAt) {
            const onTime = new Date(cf.deliveredAt).getTime() - new Date(cf.promisedAt).getTime() <= grace;
            scoredTotal++;
            onTimeTotal += onTime ? 1 : 0;
            const b = bucketOf(createdAt);
            b.scored++;
            b.onTime += onTime ? 1 : 0;
            store.scored++;
            store.onTime += onTime ? 1 : 0;
        }
        // 环节耗时
        if (cf.assignedAt && cf.deliveredAt) {
            transitSum += new Date(cf.deliveredAt).getTime() - new Date(cf.assignedAt).getTime();
            transitN++;
        }
        // 接单段排除预约单：预约单 assignedAt 在放量后写入，createdAt→assignedAt 跨数小时属正常，不代表接单效率
        if (cf.assignedAt && !cf.scheduledFor) {
            assignSum += new Date(cf.assignedAt).getTime() - createdAt;
            assignN++;
        }
        // 超时赔付归因
        if (cf.timeoutCompensatedAt) {
            compensated++;
            const a = cf.timeoutAttribution;
            if (a === 'merchant' || a === 'rider' || a === 'platform') attribution[a]++;
        }
    }

    // 趋势点：today 按小时（0 点→当前小时），滚动窗口按自然日
    const dailyTrend: StatsDailyPoint[] = [];
    if (range === 'today') {
        const endHour = campusHour(now);
        for (let h = 0; h <= endHour; h++) {
            const key = `${h}`.padStart(2, '0') + ':00';
            const b = buckets.get(key);
            dailyTrend.push({ date: key, orders: b?.orders ?? 0, onTimeRate: rateOf(b?.onTime ?? 0, b?.scored ?? 0) });
        }
    } else {
        const dayCount = range === '7d' ? 7 : 30;
        const today0 = startOfCampusDay(now);
        // UTC+8 无夏令时，逐日回退 24h 安全
        for (let i = dayCount - 1; i >= 0; i--) {
            const key = campusDayKey(today0 - i * 24 * 3600_000);
            const b = buckets.get(key);
            const label = key.slice(5); // MM-DD
            dailyTrend.push({ date: label, orders: b?.orders ?? 0, onTimeRate: rateOf(b?.onTime ?? 0, b?.scored ?? 0) });
        }
    }

    return {
        range,
        windowStart: new Date(windowStart),
        kpis: {
            totalOrders: orders.length,
            onTimeRate: rateOf(onTimeTotal, scoredTotal),
            avgDeliveryMinutes: transitN > 0 ? minOf(transitSum / transitN) : 0,
            timeoutCompensated: compensated,
        },
        dailyTrend,
        stages: [
            { key: 'assign', label: '接单', avgMinutes: assignN > 0 ? minOf(assignSum / assignN) : 0 },
            { key: 'transit', label: '在途', avgMinutes: transitN > 0 ? minOf(transitSum / transitN) : 0 },
        ],
        attribution,
        storeComparison: [...stores.entries()]
            .map(([channelId, s]) => ({
                channelId: String(channelId),
                channelName: s.name,
                orders: s.orders,
                onTimeRate: rateOf(s.onTime, s.scored),
            }))
            .sort((a, b) => b.orders - a.orders),
    };
}

@Injectable()
export class DeliveryStatsService {
    constructor(private connection: TransactionalConnection) {}

    async stats(ctx: RequestContext, rangeInput?: string | null): Promise<DeliveryStatsPayload> {
        const range = normalizeRange(rangeInput);
        const now = Date.now();
        const windowStart = windowStartOf(range, now);
        // 只计校园履约单（hallStatus 非空），避免把普通快递/自提订单计入配送 KPI
        // 租户隔离：店铺级看板非平台超管只看本渠道，否则 storeComparison 会暴露其他店铺单量
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .where('order.createdAt >= :ws', { ws: new Date(windowStart) })
            .andWhere('order.state != :st', { st: 'Cancelled' })
            .andWhere('order.customFields.hallStatus IS NOT NULL');
        if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
            qb.andWhere('channel.id = :ch', { ch: ctx.channelId as any });
        }
        const orders = (await qb.getMany()) as unknown as StatsOrderLike[];
        const configs = await this.connection.getRepository(ctx, CampusFulfillmentConfig).find();
        const graceByChannel = new Map(
            configs.map(c => [Number(c.channelId), c.timeoutGraceMinutes]),
        );
        const payload = aggregateStats({ orders, graceByChannel, windowStart, now, range });
        Logger.info(
            `delivery stats range=${range} orders=${payload.kpis.totalOrders} onTime=${payload.kpis.onTimeRate}%`,
            'CampusDeliveryStats',
        );
        return payload;
    }
}

/** 原始行的时间列可能是 pg 返回的 Date，也可能是 ::text 序列化后的字符串；统一取 epoch 毫秒。 */
function toMs(v: string | Date): number {
    return v instanceof Date ? v.getTime() : new Date(v).getTime();
}
