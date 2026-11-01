// 纯逻辑单测：grab 事务防双抢（open 可抢 / 已被抢抛「手慢了」/ 不能抢自己的订单）
import { describe, expect, it, vi } from 'vitest';
import { HallGrabService } from './hall-grab.service';

const openOrder = { id: 10, code: 'A1', customer: { id: 7 }, customFields: { hallStatus: 'open' } };

function makeSvc(order: any, opts?: { shiftCheck?: boolean; shifts?: any[] }) {
    const riderSvc = {
        assertApprovedRider: vi.fn().mockResolvedValue({
            id: 9,
            customFields: { riderStatus: 'approved', riderCredit: 100 },
        }),
    } as any;
    const updated: any[] = [];
    const em = {
        getRepository: () => ({
            findOne: vi.fn().mockResolvedValue(order),
            update: vi.fn((_id: any, patch: any) => {
                updated.push(patch);
                return Promise.resolve();
            }),
            findOneByOrFail: vi.fn().mockResolvedValue(order),
        }),
    };
    const conn = {
        getRepository: (_ctx: any, entity: any) => ({
            findOne: vi.fn().mockResolvedValue(
                entity?.name === 'CampusFulfillmentConfig'
                    ? { channelId: 1, shiftCheckEnabled: !!opts?.shiftCheck }
                    : null,
            ),
            find: vi.fn().mockResolvedValue(opts?.shifts ?? []),
        }),
        rawConnection: { transaction: (fn: any) => fn(em) },
    } as any;
    return { svc: new HallGrabService(conn, riderSvc, { user: vi.fn() } as any), updated };
}

describe('HallGrabService.grab', () => {
    it('open 订单可抢并写入 delivery customFields', async () => {
        const { svc, updated } = makeSvc(openOrder);
        await svc.grab({ channelId: 1 } as any, 10 as any);
        expect(updated[0].customFields.hallStatus).toBe('grabbed');
        expect(updated[0].customFields.deliveryStatus).toBe('assigned');
        expect(updated[0].customFields.deliveryStaffId).toBe('9');
    });
    it('已被抢订单抛「手慢了」', async () => {
        const grabbed = { ...openOrder, customFields: { hallStatus: 'grabbed' } };
        const { svc } = makeSvc(grabbed);
        await expect(svc.grab({ channelId: 1 } as any, 10 as any)).rejects.toThrow('手慢了');
    });
    it('不能抢自己的订单', async () => {
        const mine = { ...openOrder, customer: { id: 9 } };
        const { svc } = makeSvc(mine);
        await expect(svc.grab({ channelId: 1 } as any, 10 as any)).rejects.toThrow('不能抢自己的订单');
    });
});

// P3-1 班次联动：店铺开关关闭不拦截；开启后无当日班次拦截，命中时段放行
describe('HallGrabService.grab 班次校验（P3-1）', () => {
    it('开关关闭：无班次也能抢单', async () => {
        const { svc, updated } = makeSvc(openOrder, { shiftCheck: false, shifts: [] });
        await svc.grab({ channelId: 1 } as any, 10 as any);
        expect(updated[0].customFields.hallStatus).toBe('grabbed');
    });
    it('开关开启且无排班：抛「不在排班时段」', async () => {
        const { svc } = makeSvc(openOrder, { shiftCheck: true, shifts: [] });
        await expect(svc.grab({ channelId: 1 } as any, 10 as any)).rejects.toThrow('不在排班时段');
    });
    it('开关开启且当前在班次内：放行', async () => {
        const now = new Date();
        const d = new Date(now.getTime() + 8 * 3600_000);
        const p = (n: number) => String(n).padStart(2, '0');
        const today = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
        const { svc, updated } = makeSvc(openOrder, {
            shiftCheck: true,
            shifts: [{ shiftDate: today, startTime: '00:00', endTime: '23:59' }],
        });
        await svc.grab({ channelId: 1 } as any, 10 as any);
        expect(updated[0].customFields.hallStatus).toBe('grabbed');
    });
});

// plan 3.3 多单顺路：整组抢单（主单带 routeGroupId → 同组 open 单一并写同一骑手）
describe('HallGrabService.grab 整组抢单（plan 3.3）', () => {
    function makeGroupSvc(main: any, mates: any[]) {
        const riderSvc = {
            assertApprovedRider: vi.fn().mockResolvedValue({ id: 9 }),
        } as any;
        const updates: Array<{ id: any; riderId: string }> = [];
        const notifyCalls: any[] = [];
        const em = {
            getRepository: () => ({
                findOne: vi.fn().mockResolvedValue(main),
                findOneByOrFail: vi.fn().mockResolvedValue(main),
                update: vi.fn((id: any, patch: any) => {
                    updates.push({ id, riderId: patch.customFields.deliveryStaffId });
                    return Promise.resolve();
                }),
                createQueryBuilder: () => ({
                    where: vi.fn().mockReturnThis(),
                    andWhere: vi.fn().mockReturnThis(),
                    orderBy: vi.fn().mockReturnThis(),
                    setLock: vi.fn().mockReturnThis(),
                    getMany: vi.fn().mockResolvedValue(mates),
                }),
            }),
        };
        const conn = {
            getRepository: () => ({
                findOne: vi.fn().mockResolvedValue(null),
                find: vi.fn().mockResolvedValue([]),
            }),
            rawConnection: { transaction: (fn: any) => fn(em) },
        } as any;
        const svc = new HallGrabService(conn, riderSvc, { user: vi.fn((_c: any, id: any) => notifyCalls.push(id)) } as any);
        return { svc, updates, notifyCalls };
    }

    it('整组接走：组内 open 单全部写同一骑手并逐单通知', async () => {
        const main = { id: 10, code: 'A1', customer: { id: 7 }, customerId: 7, customFields: { hallStatus: 'open', routeGroupId: 'rg-x' } };
        const { svc, updates, notifyCalls } = makeGroupSvc(main, [
            { id: 11, customerId: 8, customFields: { hallStatus: 'open', routeGroupId: 'rg-x' } },
            { id: 12, customerId: 50, customFields: { hallStatus: 'grabbed', routeGroupId: 'rg-x' } }, // 已被抢，getMany 过滤由 SQL 完成，mock 模拟返回前由 hallStatus 过滤
        ].filter(m => m.customFields.hallStatus === 'open'));
        await svc.grab({ channelId: 1 } as any, 10 as any);
        expect(updates.map(u => u.id).sort()).toEqual([10, 11]);
        expect(new Set(updates.map(u => u.riderId))).toEqual(new Set(['9']));
        expect(notifyCalls.sort()).toEqual([10, 11]);
    });

    it('组内骑手自己的单跳过留在大厅', async () => {
        const main = { id: 10, code: 'A1', customer: { id: 7 }, customFields: { hallStatus: 'open', routeGroupId: 'rg-x' } };
        const { svc, updates } = makeGroupSvc(main, [
            { id: 12, customerId: 9, customFields: { hallStatus: 'open', routeGroupId: 'rg-x' } }, // 骑手自己(9)的单
        ]);
        await svc.grab({ channelId: 1 } as any, 10 as any);
        expect(updates.map(u => u.id)).toEqual([10]);
    });

    it('无 routeGroupId 的单行为不变（单卡抢单）', async () => {
        const { svc, updates, notifyCalls } = makeGroupSvc(openOrder, []);
        await svc.grab({ channelId: 1 } as any, 10 as any);
        expect(updates).toHaveLength(1);
        expect(updates[0].id).toBe(10);
        expect(notifyCalls).toEqual([10]);
    });
});

// F5 聚合大厅：一次带回全渠道（非默认渠道+有履约配置+未暂停）open 单并附店铺渠道信息
describe('HallGrabService.hallAll（F5 聚合大厅）', () => {
    function makeHallAllEnv(orders: any[], channels: any[], configs: any[]) {
        // qb 共享实例（Order repo 每次返回同一个）：测试可断言链式调用
        const qb = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            take: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(orders),
        };
        const repoFor = (ent: any) => {
            const name = (ent as any).name;
            if (name === 'CampusFulfillmentConfig') return { find: vi.fn().mockResolvedValue(configs) };
            if (name === 'Channel') return { find: vi.fn().mockResolvedValue(channels) };
            return { createQueryBuilder: () => qb };
        };
        const conn = { getRepository: (_c: any, ent: any) => repoFor(ent) } as any;
        return new HallGrabService(conn, { assertApprovedRider: vi.fn() } as any, { user: vi.fn() } as any);
    }

    const stores = [
        { id: 1, code: '__default_channel__', token: 'default' },
        { id: 2, code: 'shop-a', token: 'tok-a' },
        { id: 3, code: 'shop-b', token: 'tok-b' },
    ];

    it('open 单附加 channelId/channelName（不再下发 channelToken）；paused 渠道剔除', async () => {
        const o1 = { id: 1, code: 'A', total: 1000, shipping: 300, createdAt: new Date(), channels: [{ id: 2 }], customFields: { hallStatus: 'open', tip: 0, hallEnteredAt: new Date() } };
        const o2 = { id: 2, code: 'B', total: 2000, shipping: 300, createdAt: new Date(), channels: [{ id: 3 }], customFields: { hallStatus: 'open', tip: 100, hallEnteredAt: new Date() } };
        const svc = makeHallAllEnv(
            [o1, o2],
            stores,
            [{ channelId: 2, paused: false }, { channelId: 3, paused: true }], // shop-b 暂停
        );
        const out: any[] = await svc.hallAll({} as any);
        expect(out.map(o => o.id)).toEqual([1]);
        expect(out[0].channelId).toBe('2');
        expect(out[0].channelToken).toBeUndefined();
        expect(out[0].channelName).toBe('shop-a');
        expect(out[0].customFields.hallStatus).toBe('open');
    });

    it('跨渠道合并后统一排序：非加急单按小费降序', async () => {
        const t = (m: number) => new Date(Date.now() - m * 60_000);
        const low = { id: 1, code: 'L', channels: [{ id: 2 }], createdAt: t(3), customFields: { hallStatus: 'open', tip: 0, hallEnteredAt: t(3) } };
        const high = { id: 2, code: 'H', channels: [{ id: 3 }], createdAt: t(2), customFields: { hallStatus: 'open', tip: 50, hallEnteredAt: t(2) } };
        const svc = makeHallAllEnv(
            [low, high],
            stores,
            [{ channelId: 2, paused: false }, { channelId: 3, paused: false }],
        );
        const out: any[] = await svc.hallAll({} as any);
        expect(out.map(o => o.code)).toEqual(['H', 'L']);
    });

    it('无履约渠道时返回空数组', async () => {
        const svc = makeHallAllEnv([], stores, []);
        expect(await svc.hallAll({} as any)).toEqual([]);
    });

    it('take 截断前固定 orderBy（PG LIMIT 无 ORDER BY 截断集不确定）', async () => {
        const svc = makeHallAllEnv([], stores, [{ channelId: 2, paused: false }]);
        await svc.hallAll({} as any);
        const qb = (svc as any).connection.getRepository(null, { name: 'Order' }).createQueryBuilder();
        expect(qb.orderBy).toHaveBeenCalledWith('order.createdAt', 'ASC');
        expect(qb.take).toHaveBeenCalledWith(500);
    });
});
