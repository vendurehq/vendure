import { describe, expect, it, vi } from 'vitest';
import { nextHallStateAfterHandover, ThirdPartyDeliveryService } from './third-party-delivery.service';

describe('third-party delivery', () => {
    it('R1/R2 送达交接点 → 进抢单大厅接力', () => {
        expect(nextHallStateAfterHandover('to_campus_rider')).toEqual({
            hallStatus: 'open', deliveryStatus: null,
        });
    });

    it('R3 外部快递直送 → 直接完成', () => {
        expect(nextHallStateAfterHandover('direct_to_user')).toEqual({
            hallStatus: 'delivered', deliveryStatus: 'delivered',
        });
    });

    it('无交接方式（不认识的快照）→ 不误判完成，回落大厅', () => {
        expect(nextHallStateAfterHandover('')).toEqual({ hallStatus: 'open', deliveryStatus: null });
    });
});

describe('ThirdPartyDeliveryService.completeFirstLeg 状态前置校验', () => {
    function makeEnv(order: any) {
        const orderRepo = { findOne: vi.fn().mockResolvedValue(order) };
        const hall = {
            updateOrder: vi.fn().mockResolvedValue({}),
            enterHallForHandover: vi.fn().mockResolvedValue('1234'),
            transitionFrom: vi.fn().mockResolvedValue(true),
        };
        const notify = { user: vi.fn() };
        const conn = { getRepository: vi.fn(() => orderRepo) } as any;
        const svc = new ThirdPartyDeliveryService(conn, hall as any, notify as any, {} as any);
        return { svc, hall, notify };
    }
    const ctx = { channelId: 1 } as any;

    it('商户配送中（merchant_delivering）→ 进大厅接力', async () => {
        const { svc, hall } = makeEnv({ id: 1, code: 'A1', customFields: { fulfilment: 'x', fulfillmentRoute: 'R1', deliveryPlan: 'merchant', hallStatus: 'merchant_delivering' } });
        const res = await svc.completeFirstLeg(ctx, 1, 'merchant_handover');
        // 条件入厅：仅 merchant_delivering 可入厅，附加 handoverAt/thirdPartyState 同语句落库
        expect(hall.enterHallForHandover).toHaveBeenCalledWith(
            ctx,
            1,
            'merchant_handover',
            ['merchant_delivering'],
            expect.objectContaining({ thirdPartyState: '' }),
        );
        expect(res).toEqual({ ok: true, done: false });
    });

    it('入厅条件写未命中（并发取消）→ 拒绝，不返回成功', async () => {
        const { svc, hall } = makeEnv({ id: 1, code: 'A1', customFields: { fulfillmentRoute: 'R1', deliveryPlan: 'merchant', hallStatus: 'merchant_delivering' } });
        hall.enterHallForHandover.mockResolvedValueOnce('');
        await expect(svc.completeFirstLeg(ctx, 1, 'merchant_handover')).rejects.toThrow('第一段已送达或订单状态已变更');
    });

    it('重复调用（已回大厅 open）→ 拒绝，不重置大厅/交接码', async () => {
        const { svc, hall } = makeEnv({ id: 1, code: 'A1', customFields: { fulfillmentRoute: 'R1', deliveryPlan: 'merchant', hallStatus: 'open' } });
        await expect(svc.completeFirstLeg(ctx, 1, 'merchant_handover')).rejects.toThrow('第一段已送达或订单状态已变更');
        expect(hall.enterHallForHandover).not.toHaveBeenCalled();
    });

    it('自营快递配送中（owned_dispatched）R3 → 直接完成', async () => {
        const { svc, hall, notify } = makeEnv({ id: 2, code: 'A2', customFields: { fulfillmentRoute: 'R3', deliveryPlan: 'owned', hallStatus: 'owned_dispatched' } });
        const res = await svc.completeFirstLeg(ctx, 2, 'owned_handover');
        expect(hall.transitionFrom).toHaveBeenCalledWith(ctx, 2, ['owned_dispatched'], expect.objectContaining({
            hallStatus: 'delivered', deliveryStatus: 'delivered',
        }));
        expect(notify.user).toHaveBeenCalledWith(ctx, 2, 'orderDelivered');
        expect(res).toEqual({ ok: true, done: true });
    });

    it('R3 第一段完成时订单已取消（条件写未命中）→ 拒绝且不通知', async () => {
        const { svc, hall, notify } = makeEnv({ id: 2, code: 'A2', customFields: { fulfillmentRoute: 'R3', deliveryPlan: 'owned', hallStatus: 'owned_dispatched' } });
        hall.transitionFrom.mockResolvedValueOnce(false);
        await expect(svc.completeFirstLeg(ctx, 2, 'owned_handover')).rejects.toThrow('第一段已送达或订单状态已变更');
        expect(notify.user).not.toHaveBeenCalled();
    });

    it('状态与线路不符（自营 plan 但仍是 merchant_delivering）→ 拒绝', async () => {
        const { svc } = makeEnv({ id: 3, code: 'A3', customFields: { fulfillmentRoute: 'R1', deliveryPlan: 'owned', hallStatus: 'merchant_delivering' } });
        await expect(svc.completeFirstLeg(ctx, 3, 'owned_handover')).rejects.toThrow('第一段已送达或订单状态已变更');
    });
});

describe('ThirdPartyDeliveryService 商户接单超时转自营池后的接单/取餐/送达', () => {
    const ctx = { channelId: 1 } as any;

    function makeEnv(order: any, opts: { moved?: boolean; pickupRows?: any[] } = {}) {
        const orderRepo = { findOne: vi.fn().mockResolvedValue(order) };
        const hall = {
            transitionFrom: vi.fn().mockResolvedValue(opts.moved ?? true),
            enterHallForHandover: vi.fn().mockResolvedValue('1234'),
            updateOrder: vi.fn(),
        };
        const rawQuery = vi.fn().mockResolvedValue(opts.pickupRows ?? [[{ id: order.id }], []]);
        const conn = { getRepository: vi.fn(() => orderRepo), rawConnection: { query: rawQuery } } as any;
        const svc = new ThirdPartyDeliveryService(conn, hall as any, { user: vi.fn() } as any, {} as any);
        return { svc, hall, rawQuery };
    }

    it('自营池（owned_pool）接单成功 → 写 assigned 并清空 pickedUpAt', async () => {
        const { svc, hall } = makeEnv({ id: 5, code: 'R1T', customFields: { hallStatus: 'owned_pool', deliveryPlan: 'owned', fulfillmentRoute: 'R1' } });
        await expect(svc.acceptOwned(ctx, 5)).resolves.toEqual({ ok: true });
        expect(hall.transitionFrom).toHaveBeenCalledWith(ctx, 5, ['pending_merchant', 'open', 'owned_pool'], expect.objectContaining({
            hallStatus: 'owned_dispatched',
            deliveryStatus: 'assigned',
            assignedAt: expect.any(Date),
            pickedUpAt: null,
        }));
    });

    it('已指派骑手（owned_dispatched）重复接单 → 拒绝且不写状态', async () => {
        const { svc, hall } = makeEnv({ id: 6, code: 'R1D', customFields: { hallStatus: 'owned_dispatched', deliveryPlan: 'owned', deliveryStatus: 'assigned' } });
        await expect(svc.acceptOwned(ctx, 6)).rejects.toThrow('订单当前状态不可由自营快递接单');
        expect(hall.transitionFrom).not.toHaveBeenCalled();
    });

    it('已接单但未指派态（deliveryStatus 非 assigned）确认取餐 → 条件写不命中，拒绝', async () => {
        const { svc, rawQuery } = makeEnv(
            { id: 7, code: 'R1N', customFields: { hallStatus: 'owned_dispatched', deliveryPlan: 'owned', deliveryStatus: null } },
            { pickupRows: [[], []] },
        );
        await expect(svc.pickupOwned(ctx, 7)).rejects.toThrow('订单当前状态不可确认取餐');
        // 条件写必须同时限定「自营配送中 + 已接单未取餐」，不能放宽
        const [sql] = rawQuery.mock.calls[0];
        expect(sql).toContain("'owned_dispatched'");
        expect(sql).toContain("'assigned'");
    });

    it('R3：owned_pool → 接单 → 确认取餐 → 送达（全链路）', async () => {
        const order: any = { id: 9, code: 'R3T', customFields: { hallStatus: 'owned_pool', deliveryPlan: 'owned', fulfillmentRoute: 'R3' } };
        const orderRepo = { findOne: vi.fn(async () => order) };
        const hall = {
            transitionFrom: vi.fn(async (_c: any, _id: number, _from: string[], patch: any) => {
                Object.assign(order.customFields, patch);
                return true;
            }),
            enterHallForHandover: vi.fn().mockResolvedValue('1234'),
            updateOrder: vi.fn(),
        };
        const rawQuery = vi.fn(async (_sql: string, params: any[]) => {
            order.customFields.deliveryStatus = params[0];
            order.customFields.pickedUpAt = params[1];
            return [[{ id: order.id }], []];
        });
        const svc = new ThirdPartyDeliveryService(
            { getRepository: vi.fn(() => orderRepo), rawConnection: { query: rawQuery } } as any,
            hall as any,
            { user: vi.fn() } as any,
            {} as any,
        );

        await svc.acceptOwned(ctx, 9);
        expect(order.customFields).toMatchObject({ hallStatus: 'owned_dispatched', deliveryStatus: 'assigned', pickedUpAt: null });
        await svc.pickupOwned(ctx, 9);
        expect(order.customFields.deliveryStatus).toBe('in_progress');
        expect(order.customFields.pickedUpAt).toBeInstanceOf(Date);
        await expect(svc.completeFirstLeg(ctx, 9, 'owned_handover')).resolves.toEqual({ ok: true, done: true });
        expect(order.customFields.hallStatus).toBe('delivered');
        expect(order.customFields.deliveryStatus).toBe('delivered');
    });

    it('R1：owned_pool → 接单 → 确认取餐 → 送达交接点（入厅接力）', async () => {
        const order: any = { id: 10, code: 'R1T', customFields: { hallStatus: 'owned_pool', deliveryPlan: 'owned', fulfillmentRoute: 'R1' } };
        const orderRepo = { findOne: vi.fn(async () => order) };
        const hall = {
            transitionFrom: vi.fn(async (_c: any, _id: number, _from: string[], patch: any) => {
                Object.assign(order.customFields, patch);
                return true;
            }),
            enterHallForHandover: vi.fn().mockResolvedValue('1234'),
            updateOrder: vi.fn(),
        };
        const rawQuery = vi.fn(async (_sql: string, params: any[]) => {
            order.customFields.deliveryStatus = params[0];
            order.customFields.pickedUpAt = params[1];
            return [[{ id: order.id }], []];
        });
        const svc = new ThirdPartyDeliveryService(
            { getRepository: vi.fn(() => orderRepo), rawConnection: { query: rawQuery } } as any,
            hall as any,
            { user: vi.fn() } as any,
            {} as any,
        );

        await svc.acceptOwned(ctx, 10);
        await svc.pickupOwned(ctx, 10);
        await expect(svc.completeFirstLeg(ctx, 10, 'owned_handover')).resolves.toEqual({ ok: true, done: false });
        expect(hall.enterHallForHandover).toHaveBeenCalledWith(ctx, 10, 'owned_handover', ['owned_dispatched'], expect.anything());
    });
});

describe('ThirdPartyDeliveryService.onDeliveryStatus 回调幂等', () => {
    function makeEnv(order: any) {
        const orderRepo = { findOne: vi.fn().mockResolvedValue(order) };
        const channelRepo = { findOne: vi.fn().mockResolvedValue(null) };
        const cfgRepo = { findOne: vi.fn().mockResolvedValue(null) };
        const hall = {
            updateOrder: vi.fn().mockResolvedValue({}),
            enterHallForHandover: vi.fn().mockResolvedValue('1234'),
            transitionFrom: vi.fn().mockResolvedValue(true),
        };
        const notify = { user: vi.fn() };
        // 第三方字段条件写（P3）：默认命中一行；置 [] 模拟订单已取消/并发状态变更
        const rawQuery = vi.fn().mockResolvedValue([[{ id: 1 }], []]);
        const conn = {
            getRepository: vi.fn(() => orderRepo),
            rawConnection: {
                getRepository: vi.fn((ent: any) => ((ent as any).name === 'Channel' ? channelRepo : cfgRepo)),
                query: rawQuery,
            },
        } as any;
        const svc = new ThirdPartyDeliveryService(conn, hall as any, notify as any, {} as any);
        return { svc, hall, notify, rawQuery };
    }
    const ctx = { channelId: 1 } as any;
    const update = (status: any) => ({ orderId: 1, thirdPartyNo: 'TP1', status });

    it('送达回调落在已进大厅的单 → 只补状态，不二次入厅（防重复派送/分成）', async () => {
        const { svc, hall, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'pickup', hallStatus: 'open', handoverMode: 'to_campus_rider' },
        });
        await svc.onDeliveryStatus(ctx, update('delivered'));
        expect(hall.enterHallForHandover).not.toHaveBeenCalled();
        expect(rawQuery).toHaveBeenCalledOnce();
        const [sql, params] = rawQuery.mock.calls[0];
        expect(sql).not.toContain('Hallstatus');
        expect(params).toContain('delivered');
    });

    it('送达后的乱序回调 → 忽略，不回退状态', async () => {
        const { svc, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'delivered', hallStatus: 'delivered' },
        });
        await svc.onDeliveryStatus(ctx, update('accepted'));
        expect(rawQuery).not.toHaveBeenCalled();
    });

    it('同状态重复回调 → 忽略', async () => {
        const { svc, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'pickup', hallStatus: 'third_party' },
        });
        await svc.onDeliveryStatus(ctx, update('pickup'));
        expect(rawQuery).not.toHaveBeenCalled();
    });

    it('乱序回退（pickup 后收到 accepted）→ 忽略', async () => {
        const { svc, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'pickup', hallStatus: 'third_party' },
        });
        await svc.onDeliveryStatus(ctx, update('accepted'));
        expect(rawQuery).not.toHaveBeenCalled();
    });

    it('仍处 third_party 的送达回调 → 正常入厅接力', async () => {
        const { svc, hall } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'pickup', hallStatus: 'third_party', handoverMode: 'to_campus_rider' },
        });
        await svc.onDeliveryStatus(ctx, update('delivered'));
        expect(hall.enterHallForHandover).toHaveBeenCalledWith(
            expect.anything(),
            1,
            'external_handover',
            ['third_party'],
            expect.objectContaining({ thirdPartyState: 'delivered' }),
        );
    });

    it('R2 送达回调入厅同时写 leg1Status=arrived_gate（第一段权威事实源）', async () => {
        const { svc, hall } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'pickup', hallStatus: 'third_party', handoverMode: 'to_campus_rider', fulfillmentRoute: 'R2' },
        });
        await svc.onDeliveryStatus(ctx, update('delivered'));
        expect(hall.enterHallForHandover).toHaveBeenCalledWith(
            expect.anything(), 1, 'external_handover', ['third_party'],
            expect.objectContaining({ leg1Status: 'arrived_gate', handoverAt: expect.any(Date) }),
        );
    });

    it('已取消订单收到送达回调 → 只补状态，不复活进入大厅', async () => {
        const { svc, hall, rawQuery } = makeEnv({
            id: 1, code: 'A1', state: 'Cancelled',
            customFields: { thirdPartyState: 'pickup', hallStatus: 'cancelled', handoverMode: 'to_campus_rider' },
        });
        rawQuery.mockResolvedValueOnce([[], []]); // state=Cancelled → 条件写不命中
        await svc.onDeliveryStatus(ctx, update('delivered'));
        expect(hall.enterHallForHandover).not.toHaveBeenCalled();
        expect(rawQuery.mock.calls[0][0]).not.toContain('Hallstatus');
    });

    it('R3 外部运力异常 → 条件写回大厅并刷新入厅时间', async () => {
        const { svc, hall, notify } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'accepted', hallStatus: 'third_party', fulfillmentRoute: 'R3' },
        });
        await svc.onDeliveryStatus(ctx, update('exception'));
        expect(hall.transitionFrom).toHaveBeenCalledWith(
            expect.anything(),
            1,
            ['third_party'],
            expect.objectContaining({ hallStatus: 'open', hallEnteredAt: expect.any(Date) }),
        );
        // §4/§6：异常态不能静默，顾客必须收到「配送方式调整」
        expect(notify.user).toHaveBeenCalledWith(expect.anything(), 1, 'deliveryFallback', '运力异常，重新派送');
    });
    it('旧运单号迟到回调（已换运力重推）→ 忽略，不污染新运单状态', async () => {
        const { svc, hall, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyNo: 'TP2', thirdPartyState: 'pending', hallStatus: 'third_party' },
        });
        await svc.onDeliveryStatus(ctx, { ...update('delivered'), thirdPartyNo: 'TP1' });
        expect(rawQuery).not.toHaveBeenCalled();
        expect(hall.transitionFrom).not.toHaveBeenCalled();
    });

    it('已取消终态后的迟到回调 → 忽略（cancelled/exception 同属终态档）', async () => {
        const { svc, hall, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyNo: 'TP1', thirdPartyState: 'cancelled', hallStatus: 'open' },
        });
        await svc.onDeliveryStatus(ctx, update('delivered'));
        expect(rawQuery).not.toHaveBeenCalled();
        expect(hall.enterHallForHandover).not.toHaveBeenCalled();
    });

    it('中间态回调条件写未命中（并发已推进/已取消）→ 不覆盖也不发接单通知', async () => {
        const { svc, notify, rawQuery } = makeEnv({
            id: 1, code: 'A1',
            customFields: { thirdPartyState: 'pending', hallStatus: 'third_party' },
        });
        rawQuery.mockResolvedValueOnce([[], []]);
        await svc.onDeliveryStatus(ctx, update('accepted'));
        expect(rawQuery).toHaveBeenCalledOnce();
        expect(rawQuery.mock.calls[0][0]).toContain('customFieldsThirdpartystate');
        expect(notify.user).not.toHaveBeenCalled();
    });
});

describe('ThirdPartyDeliveryService.cancel 回退条件写（第13轮）', () => {
    const ctx = { channelId: 1 } as any;

    function makeEnv(opts: { order: any; fresh?: any; moved?: boolean; cancelOk?: boolean }) {
        const orderRepo = {
            findOne: vi.fn()
                .mockResolvedValueOnce(opts.order) // doCancel 初次读
                .mockResolvedValueOnce(opts.fresh ?? opts.order), // 平台取消成功后重读
        };
        const rawQuery = vi.fn().mockResolvedValue([[{ id: 1 }], []]);
        const conn = {
            getRepository: vi.fn(() => orderRepo),
            rawConnection: {
                // ctxForChannel 建 Channel 上下文：缺省空渠道即可
                getRepository: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })),
                query: rawQuery,
                createQueryRunner: () => ({
                    connect: vi.fn().mockResolvedValue(undefined),
                    query: vi.fn().mockResolvedValue([[{ ok: true }], []]),
                    release: vi.fn().mockResolvedValue(undefined),
                }),
            },
        } as any;
        const hall = {
            transitionFrom: vi.fn().mockResolvedValue(opts.moved ?? true),
            updateOrder: vi.fn(),
        };
        const gateway = { cancelDelivery: vi.fn().mockResolvedValue({ success: opts.cancelOk ?? true }) };
        const svc = new ThirdPartyDeliveryService(
            conn,
            hall as any,
            { user: vi.fn() } as any,
            { get: vi.fn(() => gateway) } as any,
        );
        return { svc, hall, rawQuery };
    }

    const order = (route: string) => ({
        id: 7,
        code: 'TP7',
        channels: [{ id: 1 }],
        customFields: {
            thirdPartyDeliveryOrderId: 'TP1',
            thirdPartyState: 'accepted',
            hallStatus: 'third_party',
            fulfillmentRoute: route,
        },
    });

    it('R3 取消成功 → 按 third_party 条件写回抢单大厅（CAS，不再读后无条件覆写）', async () => {
        const { svc, hall } = makeEnv({ order: order('R3') });
        await expect(svc.cancel(ctx, 7)).resolves.toMatchObject({ ok: true });
        expect(hall.transitionFrom).toHaveBeenCalledWith(
            expect.anything(),
            7,
            ['third_party'],
            expect.objectContaining({
                hallStatus: 'open',
                thirdPartyState: 'cancelled',
                deliveryPlan: 'campus_rider',
                campusCause: 'third_party_cancelled',
            }),
        );
        expect(hall.updateOrder).not.toHaveBeenCalled();
    });

    it('R2 取消成功 → 回待推送（运营换一家重推）', async () => {
        const { svc, hall } = makeEnv({ order: order('R2') });
        await svc.cancel(ctx, 7);
        expect(hall.transitionFrom).toHaveBeenCalledWith(
            expect.anything(),
            7,
            ['third_party'],
            expect.objectContaining({ hallStatus: 'pending_dispatch', thirdPartyState: 'cancelled' }),
        );
    });

    it('读后已被取消/回退（CAS 未命中）→ 只补第三方状态，绝不改 hallStatus', async () => {
        const { svc, hall, rawQuery } = makeEnv({ order: order('R3'), moved: false });
        await svc.cancel(ctx, 7);
        expect(hall.transitionFrom).toHaveBeenCalledOnce();
        expect(hall.updateOrder).not.toHaveBeenCalled();
        expect(rawQuery).toHaveBeenCalledOnce();
        const [sql, params] = rawQuery.mock.calls[0];
        expect(sql).not.toContain('Hallstatus');
        expect(params).toContain('cancelled');
    });
});
