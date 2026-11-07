import { describe, expect, it, vi } from 'vitest';
import { aggregateStats, windowStartOf, normalizeRange, DeliveryStatsService } from './delivery-stats.service';
import { campusHour } from './campus-time';
import { instantToDbNowWall } from './db-now-wall';

const now = new Date('2026-10-23T15:30:00+08:00').getTime();
const min = (m: number, base = now) => new Date(base - m * 60_000);
const order = (id: number, ch: number, cf: any, extra: any = {}) => ({
    id,
    code: `A${id}`,
    state: 'Delivered',
    // createdAt 是 DB now() 写入的 UTC 墙钟：造数模拟 pg 读回（本地字段 = UTC 墙钟）
    createdAt: instantToDbNowWall(cf.createdAt ?? min(60)),
    channels: [{ id: ch, code: ch === 9 ? '__default_channel__' : `shop-${ch}`, customFields: ch === 1 ? { shopName: '一食堂麻辣香锅' } : {} }],
    customFields: cf,
    ...extra,
});

describe('normalizeRange / windowStartOf', () => {
    it('非法 range 回退 7d', () => {
        expect(normalizeRange('xx')).toBe('7d');
        expect(normalizeRange(undefined)).toBe('7d');
        expect(normalizeRange('today')).toBe('today');
        expect(normalizeRange('30d')).toBe('30d');
    });
    it('today 窗口起点为校园时区（UTC+8）0 点，不随服务器时区漂移', () => {
        expect(windowStartOf('today', now)).toBe(new Date('2026-10-23T00:00:00+08:00').getTime());
    });
    it('7d 窗口起点为 now-7天', () => {
        expect(windowStartOf('7d', now)).toBe(now - 7 * 24 * 3600_000);
    });
});

describe('aggregateStats', () => {
    it('KPI：单量/准点率/平均送达/赔付数（grace 边界：恰好 grace 记准点）', () => {
        const grace = 10;
        const orders = [
            // 准点：late=9min
            order(1, 1, { promisedAt: min(30), deliveredAt: min(21), assignedAt: min(28), timeoutCompensatedAt: null }),
            // 恰好 grace=10min → 准点
            order(2, 1, { promisedAt: min(30), deliveredAt: min(20), assignedAt: min(28) }),
            // 超 grace 1min → 迟到，无赔付闸（不计 compensated）
            order(3, 1, { promisedAt: min(30), deliveredAt: min(19), assignedAt: min(28) }),
            // 已赔付单
            order(4, 1, { promisedAt: min(40), deliveredAt: min(5), assignedAt: min(38), timeoutCompensatedAt: min(4), timeoutAttribution: 'merchant' }),
        ];
        const res = aggregateStats({
            orders,
            graceByChannel: new Map([[1, grace]]),
            windowStart: now - 24 * 3600_000,
            now,
            range: '7d',
        });
        expect(res.kpis.totalOrders).toBe(4);
        expect(res.kpis.onTimeRate).toBe(50); // 2/4
        // 在途均值：7,8,9,33 → 14.25（round1 → 14.3）
        expect(res.kpis.avgDeliveryMinutes).toBe(14.3);
        expect(res.kpis.timeoutCompensated).toBe(1);
        expect(res.attribution).toEqual({ merchant: 1, rider: 0, platform: 0 });
    });

    it('Cancelled 单不计入单量', () => {
        const res = aggregateStats({
            orders: [order(1, 1, { promisedAt: min(30), deliveredAt: min(20) }), order(2, 1, {}, { state: 'Cancelled' })],
            graceByChannel: new Map([[1, 10]]),
            windowStart: now - 24 * 3600_000,
            now,
            range: '7d',
        });
        expect(res.kpis.totalOrders).toBe(1);
    });

    it('环节耗时：接单=createdAt→assignedAt，在途=assignedAt→deliveredAt，无数据段为 0', () => {
        const orders = [
            order(1, 1, { createdAt: min(40), promisedAt: min(30), assignedAt: min(30), deliveredAt: min(10) }),
        ];
        const res = aggregateStats({
            orders,
            graceByChannel: new Map([[1, 10]]),
            windowStart: now - 24 * 3600_000,
            now,
            range: '7d',
        });
        expect(res.stages).toEqual([
            { key: 'assign', label: '接单', avgMinutes: 10 },
            { key: 'transit', label: '在途', avgMinutes: 20 },
        ]);
    });

    it('接单段排除预约单（scheduledFor 非空：assignedAt 在放量后写入，跨时长不代表接单效率）', () => {
        const orders = [
            order(1, 1, { createdAt: min(40), assignedAt: min(30), scheduledFor: min(-600) }), // 预约单
            order(2, 1, { createdAt: min(20), assignedAt: min(10) }), // 即时单
        ];
        const res = aggregateStats({
            orders,
            graceByChannel: new Map([[1, 10]]),
            windowStart: now - 24 * 3600_000,
            now,
            range: '7d',
        });
        expect(res.stages[0].avgMinutes).toBe(10); // 仅即时单计入
        expect(res.kpis.totalOrders).toBe(2); // 单量不受影响
    });

    it('dailyTrend 7d：逐日出点，无单日补零', () => {
        const res = aggregateStats({
            orders: [order(1, 1, { promisedAt: min(30), deliveredAt: min(20), createdAt: min(60) })],
            graceByChannel: new Map([[1, 10]]),
            windowStart: now - 7 * 24 * 3600_000,
            now,
            range: '7d',
        });
        expect(res.dailyTrend).toHaveLength(7);
        expect(res.dailyTrend[6].orders).toBe(1);
        expect(res.dailyTrend[0].orders).toBe(0);
        expect(res.dailyTrend[6].onTimeRate).toBe(100);
        expect(res.dailyTrend[0].onTimeRate).toBe(0);
    });

    it('dailyTrend today：按小时出点至当前小时', () => {
        const h = campusHour(now);
        const res = aggregateStats({
            orders: [order(1, 1, { promisedAt: min(30), deliveredAt: min(20), createdAt: min(5) })],
            graceByChannel: new Map([[1, 10]]),
            windowStart: windowStartOf('today', now),
            now,
            range: 'today',
        });
        expect(res.dailyTrend).toHaveLength(h + 1);
        expect(res.dailyTrend[h].orders).toBe(1);
        expect(res.dailyTrend[h].date.endsWith(':00')).toBe(true);
    });

    it('店铺对比：按渠道分组，default 渠道被排除取名，无承诺单不计准点分母', () => {
        const orders = [
            order(1, 1, { promisedAt: min(30), deliveredAt: min(20) }),
            order(2, 1, { promisedAt: min(30), deliveredAt: min(5) }), // 迟到
            order(3, 2, { promisedAt: min(30), deliveredAt: min(25) }),
            order(4, 9, { promisedAt: min(30), deliveredAt: min(25) }), // default 渠道名被跳过
            order(5, 1, {}), // 无承诺：计单量不计准点
        ];
        const res = aggregateStats({
            orders,
            graceByChannel: new Map([[1, 10], [2, 10]]),
            windowStart: now - 24 * 3600_000,
            now,
            range: '7d',
        });
        expect(res.storeComparison).toHaveLength(3);
        const s1 = res.storeComparison.find(s => s.channelId === '1')!;
        // 店铺名优先取渠道 customFields.shopName（中文店名），无则回退渠道 code
        expect(s1.channelName).toBe('一食堂麻辣香锅');
        expect(res.storeComparison.find(s => s.channelId === '2')!.channelName).toBe('shop-2');
        expect(s1.orders).toBe(3);
        expect(s1.onTimeRate).toBe(50); // 1/2
        expect(res.storeComparison[0].orders).toBe(3); // 排序按单量降序
        // 无承诺单不影响整体准点分母（计分单：1,2,3,4 → 准点 1,3,4）
        expect(res.kpis.onTimeRate).toBe(75); // 3/4
    });

    it('各渠道 grace 独立生效（店 A grace=10 准点、店 B grace=60 同样延迟记准点）', () => {
        const deliveredAt = min(20);
        const orders = [
            order(1, 1, { promisedAt: min(40), deliveredAt }),
            order(2, 2, { promisedAt: min(40), deliveredAt }),
        ];
        const res = aggregateStats({
            orders,
            graceByChannel: new Map([[1, 10], [2, 60]]),
            windowStart: now - 24 * 3600_000,
            now,
            range: '7d',
        });
        const s1 = res.storeComparison.find(s => s.channelId === '1')!;
        const s2 = res.storeComparison.find(s => s.channelId === '2')!;
        expect(s1.onTimeRate).toBe(0); // late=20 > 10
        expect(s2.onTimeRate).toBe(100); // late=20 ≤ 60
    });
});

describe('DeliveryStatsService.stats 口径', () => {
    it('SQL 只取校园履约单（hallStatus 非空）', async () => {
        const andWhere = vi.fn().mockReturnThis();
        const qb = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere,
            getMany: vi.fn().mockResolvedValue([]),
        };
        const repo = { createQueryBuilder: vi.fn(() => qb), find: vi.fn().mockResolvedValue([]) };
        const svc = new DeliveryStatsService({ getRepository: vi.fn(() => repo) } as any);
        await svc.stats({ channelId: 1, userHasPermissions: () => true } as any, 'today');
        expect(andWhere).toHaveBeenCalledWith('order.customFields.hallStatus IS NOT NULL');
    });

    it('非平台超管按当前渠道过滤（防跨租户看板泄漏）', async () => {
        const andWhere = vi.fn().mockReturnThis();
        const qb = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere,
            getMany: vi.fn().mockResolvedValue([]),
        };
        const repo = { createQueryBuilder: vi.fn(() => qb), find: vi.fn().mockResolvedValue([]) };
        const svc = new DeliveryStatsService({ getRepository: vi.fn(() => repo) } as any);
        await svc.stats({ channelId: 7, userHasPermissions: () => false } as any, 'today');
        expect(andWhere).toHaveBeenCalledWith('channel.id = :ch', { ch: 7 });
    });
});
