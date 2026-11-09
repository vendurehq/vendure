import { describe, expect, it, vi } from 'vitest';
import { DispatchAdminService } from './dispatch-admin.service';
import { FORCE_CANCEL_MARK, campusCancelGuardProcess } from './cancel-guard.process';

interface HandleEnvOpts {
    orders?: any[];
    onlineRiders?: any[];
    cfg?: any;
    payment?: any;
    refundedSum?: number;
    orderSvc?: any;
    /** 飞书告警 mock（注入惰性服务，避免 ModuleRef） */
    feishu?: any;
}

function makeEnv(opts: HandleEnvOpts = {}) {
    const grabSvc = { grabByRider: vi.fn().mockResolvedValue(true) };
    const hallSvc = {
        backToHall: vi.fn().mockResolvedValue(true),
        updateOrder: vi.fn().mockResolvedValue({}),
        // 异常处置留痕/回滚改条件写（CAS）：默认命中
        transitionFrom: vi.fn().mockResolvedValue(true),
    };
    const capacitySvc = { listOnlineRiders: vi.fn().mockResolvedValue(opts.onlineRiders ?? []) };
    const orderRepo = {
        findOne: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        createQueryBuilder: () => ({
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(opts.orders ?? []),
        }),
    };
    const configRepo = {
        findOne: vi.fn().mockResolvedValue(opts.cfg ?? { autoAssignMinutes: 10, inProgressSlaMinutes: 45 }),
    };
    const paymentRepo = {
        // 可退支付单查询（state 必须是 Settled/Authorized）
        find: vi.fn().mockImplementation(async () => (opts.payment ? [{ ...opts.payment, state: 'Settled' }] : [])),
        findOne: vi.fn().mockResolvedValue(opts.payment ?? null),
    };
    const refundRepo = {
        createQueryBuilder: () => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            // P1：已退总额排除 Failed 退款单
            andWhere: vi.fn().mockReturnThis(),
            getRawOne: vi.fn().mockResolvedValue({ sum: String(opts.refundedSum ?? 0) }),
        }),
        // settleRefundOrMarkFailed 读取退款单关联 paymentId 作 transactionId
        findOne: vi.fn().mockResolvedValue({ id: 55, paymentId: 9 }),
        // 结算失败置 Failed
        update: vi.fn().mockResolvedValue({}),
    };
    const rawQuery = vi.fn().mockResolvedValue([{ id: 1 }]);
    const conn = {
        getRepository: vi.fn((_ctx: any, ent: any) => {
            const name = (ent as any).name;
            if (name === 'CampusFulfillmentConfig') return configRepo;
            return orderRepo;
        }),
        rawConnection: {
            // 异常处置认领（UPDATE ... RETURNING）：默认认领成功
            query: rawQuery,
            // 退款咨询锁：默认抢锁成功
            createQueryRunner: () => ({
                connect: vi.fn().mockResolvedValue(undefined),
                query: vi.fn().mockResolvedValue([[{ ok: true }], []]),
                release: vi.fn().mockResolvedValue(undefined),
            }),
            getRepository: vi.fn((ent: any) => {
                const name = (ent as any).name ?? ent;
                if (name === 'Payment') return paymentRepo;
                return refundRepo;
            }),
        },
    } as any;
    const svc = new DispatchAdminService(conn, grabSvc as any, hallSvc as any, capacitySvc as any, {} as any, { user: vi.fn() } as any);
    // 测试直接注入惰性服务，绕过 ModuleRef/require（handleException 专用）
    const orderSvc = opts.orderSvc ?? {
        refundOrder: vi.fn().mockResolvedValue({ id: 55 }),
        settleRefund: vi.fn().mockResolvedValue({}),
        cancelOrder: vi.fn().mockResolvedValue({}),
    };
    (svc as any).orderSvc = orderSvc;
    // 直接注入飞书（undefined → 保持未解析，测试不走 ModuleRef）
    if (opts.feishu) (svc as any).feishuSvc = opts.feishu;
    return { svc, grabSvc, hallSvc, capacitySvc, orderRepo, configRepo, paymentRepo, refundRepo, rawQuery, orderSvc, notifySvc: (svc as any).notify };
}

const now = Date.now();
const minAgo = (m: number) => new Date(now - m * 60_000);
const exceptionOrder = (id: number, code: string, extra: any = {}) => ({
    id,
    code,
    customerId: 160,
    totalWithTax: 2300,
    channels: [{ id: 1 }],
    customFields: { hallStatus: 'grabbed', deliveryStatus: 'exception', exceptionType: 'food_spilled', ...extra },
});

describe('DispatchAdminService.board', () => {
    it('滞留超 autoAssignMinutes 的 open 单 → alert stale_open', async () => {
        const { svc } = makeEnv({
            orders: [{ id: 1, code: 'A1', customFields: { hallStatus: 'open', hallEnteredAt: minAgo(12), campusZone: 'A区' } }],
            cfg: { autoAssignMinutes: 10, inProgressSlaMinutes: 45 },
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.alerts[0]).toEqual(expect.objectContaining({ orderId: '1', type: 'stale_open' }));
    });

    it('open 未超时 → 不告警，进 hallOrders', async () => {
        const { svc } = makeEnv({
            orders: [{ id: 1, code: 'A1', customFields: { hallStatus: 'open', hallEnteredAt: minAgo(3) } }],
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.alerts).toHaveLength(0);
        expect(board.hallOrders).toHaveLength(1);
        expect(board.activeOrders).toHaveLength(0);
    });

    it('in_progress 超 SLA → alert sla_breach', async () => {
        const { svc } = makeEnv({
            orders: [{ id: 2, code: 'A2', customFields: { hallStatus: 'grabbed', deliveryStatus: 'in_progress', assignedAt: minAgo(50) } }],
            cfg: { inProgressSlaMinutes: 45 },
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.alerts[0]).toEqual(expect.objectContaining({ orderId: '2', type: 'sla_breach' }));
        expect(board.activeOrders).toHaveLength(1);
    });

    it('campusCause=slot_full → alert slot_full', async () => {
        const { svc } = makeEnv({
            orders: [{ id: 3, code: 'A3', customFields: { hallStatus: 'open', hallEnteredAt: minAgo(1), campusCause: 'slot_full' } }],
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.alerts[0]).toEqual(expect.objectContaining({ orderId: '3', type: 'slot_full' }));
    });

    it('campusCause=address_change_cancel_failed → 常驻 exception 告警（旧运单仍送旧地址）', async () => {
        const { svc } = makeEnv({
            orders: [
                {
                    id: 4,
                    code: 'A4',
                    customFields: { hallStatus: 'third_party', campusCause: 'address_change_cancel_failed' },
                },
            ],
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.alerts[0]).toEqual(
            expect.objectContaining({ orderId: '4', type: 'exception', detail: expect.stringContaining('旧地址') }),
        );
        expect(board.activeOrders).toHaveLength(1);
    });

    it('终态单（取消/无人接退款/已送达）与历史脏数据不进调度墙', async () => {
        const { svc } = makeEnv({
            orders: [
                { id: 11, code: 'C1', customFields: { hallStatus: 'cancelled', deliveryStatus: 'pending' } },
                { id: 12, code: 'C2', customFields: { hallStatus: 'no_rider_final' } },
                { id: 13, code: 'C3', customFields: { hallStatus: 'delivered', deliveryStatus: 'delivered' } },
                // 历史脏数据：送达后 hallStatus 未同步
                { id: 14, code: 'C4', customFields: { hallStatus: 'grabbed', deliveryStatus: 'delivered' } },
            ],
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.hallOrders).toHaveLength(0);
        expect(board.activeOrders).toHaveLength(0);
        expect(board.alerts).toHaveLength(0);
        expect(board.handledOrders).toHaveLength(0);
    });

    it('exception_final 已处置完结单 → 不进墙，进 handledOrders 留痕（plan 3.4）', async () => {
        const { svc } = makeEnv({
            orders: [
                exceptionOrder(9, 'A9', { hallStatus: 'exception_final', exceptionAction: 'refund_diff', exceptionCompensation: 300, exceptionHandledAt: minAgo(2), exceptionHandledBy: '3' }),
                { id: 1, code: 'A1', customFields: { hallStatus: 'open', hallEnteredAt: minAgo(3) } },
            ],
        });
        const board = await svc.board({ channelId: 1 } as any);
        expect(board.hallOrders).toHaveLength(1);
        expect(board.activeOrders).toHaveLength(0);
        expect(board.handledOrders).toEqual([
            expect.objectContaining({ orderId: '9', orderCode: 'A9', action: 'refund_diff', compensation: 300, handledBy: '3' }),
        ]);
        // 处置时间必须输出 ISO 字符串，否则前端 hhmm 会渲染 NaN:NaN
        expect(board.handledOrders[0].handledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('DispatchAdminService.assign 资质校验', () => {
    const ctx = { channelId: 1 } as any;
    const order = { id: 5, code: 'A5', channels: [{ id: 1 }], customFields: { hallStatus: 'open' } };

    it('未审核/已停用骑手 → 拒绝派单', async () => {
        const { svc, orderRepo, grabSvc } = makeEnv();
        orderRepo.findOne
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ id: 9, customFields: { riderStatus: 'pending', riderCredit: 100 } });
        await expect(svc.assign(ctx, 5 as any, 9 as any)).rejects.toThrow('该骑手未通过审核或已停用');
        expect(grabSvc.grabByRider).not.toHaveBeenCalled();
    });

    it('信用分低于 60 → 拒绝派单', async () => {
        const { svc, orderRepo, grabSvc } = makeEnv();
        orderRepo.findOne
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ id: 9, customFields: { riderStatus: 'approved', riderCredit: 59, riderOnlineAt: new Date() } });
        await expect(svc.assign(ctx, 5 as any, 9 as any)).rejects.toThrow('该骑手信用分不足');
        expect(grabSvc.grabByRider).not.toHaveBeenCalled();
    });

    it('离线骑手（心跳超 5min）→ 拒绝派单', async () => {
        const { svc, orderRepo, grabSvc } = makeEnv();
        orderRepo.findOne
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ id: 9, customFields: { riderStatus: 'approved', riderCredit: 88, riderOnlineAt: minAgo(6) } });
        await expect(svc.assign(ctx, 5 as any, 9 as any)).rejects.toThrow('该骑手当前不在线，无法派单');
        expect(grabSvc.grabByRider).not.toHaveBeenCalled();
    });

    it('在职且信用达标 → 正常强派', async () => {
        const { svc, orderRepo, grabSvc } = makeEnv();
        orderRepo.findOne
            .mockResolvedValueOnce(order)
            .mockResolvedValueOnce({ id: 9, customFields: { riderStatus: 'approved', riderCredit: 88, riderOnlineAt: new Date() } });
        await expect(svc.assign(ctx, 5 as any, 9 as any)).resolves.toEqual({ assigned: true });
        expect(grabSvc.grabByRider).toHaveBeenCalledWith(ctx, 5, { id: 9 });
    });
});

describe('DispatchAdminService.handleException', () => {
    const ctx = { channelId: 1, activeUserId: 3 } as any;

    it('非异常单拒绝处置', async () => {
        const { svc, orderRepo } = makeEnv();
        orderRepo.findOne.mockResolvedValue({ id: 5, code: 'A5', channels: [{ id: 1 }], customFields: { deliveryStatus: 'in_progress' } });
        await expect(svc.handleException(ctx, 5 as any, 'refund_diff', 300)).rejects.toThrow('仅骑手上报异常的订单可处置');
    });

    it('reassign：回大厅 + 重置入厅时间 + 留痕，不置 exception_final', async () => {
        const { svc, orderRepo, hallSvc, notifySvc } = makeEnv();
        orderRepo.findOne.mockResolvedValue(exceptionOrder(6, 'A6'));
        const res = await svc.handleException(ctx, 6 as any, 'reassign', undefined, undefined, '改派');
        expect(res).toEqual({ ok: true, action: 'reassign' });
        expect(hallSvc.backToHall).toHaveBeenCalledWith(ctx, 6);
        // 先条件重置入厅时间（仅 open；否则同轮 T4 按旧 hallEnteredAt 立即退款）
        expect(hallSvc.transitionFrom).toHaveBeenNthCalledWith(1, ctx, 6, ['open'], expect.objectContaining({
            hallEnteredAt: expect.any(Date),
            campusCause: 'exception_reassign',
        }));
        const patch = hallSvc.transitionFrom.mock.calls[1][3];
        expect(patch).toEqual(expect.objectContaining({ exceptionAction: 'reassign', exceptionHandledNote: '改派', exceptionHandledBy: '3' }));
        expect(patch.hallStatus).toBeUndefined();
        // 处置完结 push：reassign 也通知（dedupe 后缀=本次异常上报时间）
        expect(notifySvc.user).toHaveBeenCalledWith(ctx, 6, 'exceptionHandled', '平台已重新安排配送', undefined, expect.any(String));
    });

    it('refund_diff：部分退款（shipping/adjustment 显式 0）+ settleRefund + exception_final 留痕', async () => {
        const { svc, orderRepo, hallSvc, orderSvc, paymentRepo } = makeEnv({
            payment: { id: 9, amount: 2300 },
            refundedSum: 0,
        });
        paymentRepo.find.mockResolvedValue([{ id: 9, amount: 2300, state: 'Settled' }]);
        orderRepo.findOne.mockResolvedValue(exceptionOrder(7, 'A7'));
        await svc.handleException(ctx, 7 as any, 'refund_diff', 300, undefined, '洒漏赔付');
        expect(orderSvc.refundOrder).toHaveBeenCalledWith(ctx, expect.objectContaining({
            paymentId: 9, amount: 300, shipping: 0, adjustment: 0,
        }));
        expect(orderSvc.settleRefund).toHaveBeenCalledWith(ctx, { id: 55, transactionId: 9 });
        // 留痕条件写：仅 exception_final 单写处置记录
        expect(hallSvc.transitionFrom).toHaveBeenCalledWith(
            ctx, 7, ['exception_final'], expect.any(Object),
        );
        const patch = hallSvc.transitionFrom.mock.calls[0][3];
        expect(patch).toEqual(expect.objectContaining({
            exceptionAction: 'refund_diff', exceptionCompensation: 300, hallStatus: 'exception_final',
        }));
    });

    it('refund_diff 结算失败 → 退款单置 Failed + refund_failed + 飞书告警，不回滚认领', async () => {
        const feishu = { pushEvent: vi.fn() };
        const orderSvc = {
            refundOrder: vi.fn().mockResolvedValue({ id: 55 }),
            settleRefund: vi.fn().mockRejectedValue(new Error('provider down')),
            cancelOrder: vi.fn().mockResolvedValue({}),
        };
        const { svc, orderRepo, hallSvc, refundRepo } = makeEnv({
            payment: { id: 9, amount: 2300 }, refundedSum: 0, orderSvc, feishu,
        });
        orderRepo.findOne.mockResolvedValue(exceptionOrder(7, 'A7'));

        await expect(svc.handleException(ctx, 7 as any, 'refund_diff', 300)).rejects.toThrow('provider down');

        // 未真实打款的退款单不能继续计入已退总额，否则重试会跳过退款直接完结订单
        expect(refundRepo.update).toHaveBeenCalledWith(55, { state: 'Failed' });
        // 置 refund_failed 退出自动重试并告警
        expect(hallSvc.transitionFrom).toHaveBeenCalledTimes(1);
        expect(hallSvc.transitionFrom).toHaveBeenCalledWith(
            ctx, 7, ['exception_final'], expect.objectContaining({ hallStatus: 'refund_failed', campusCause: 'refund_failed' }),
        );
        expect(feishu.pushEvent).toHaveBeenCalledWith(
            'exception', '异常处置退款失败', expect.stringContaining('A7'), 'A7', 'exception_refund_failed:A7',
        );
    });

    it('refund_diff 退款失败但订单已取消（条件写未命中）→ 不回滚也不告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const orderSvc = {
            refundOrder: vi.fn().mockResolvedValue({ id: 55 }),
            settleRefund: vi.fn().mockRejectedValue(new Error('provider down')),
            cancelOrder: vi.fn().mockResolvedValue({}),
        };
        const { svc, orderRepo, hallSvc } = makeEnv({
            payment: { id: 9, amount: 2300 }, refundedSum: 0, orderSvc, feishu,
        });
        orderRepo.findOne.mockResolvedValue(exceptionOrder(7, 'A7'));
        hallSvc.transitionFrom.mockResolvedValue(false);

        await expect(svc.handleException(ctx, 7 as any, 'refund_diff', 300)).rejects.toThrow('provider down');
        expect(feishu.pushEvent).not.toHaveBeenCalled();
    });
    it('refund_diff 超可退余额（已全额退）→ 拒绝', async () => {
        const { svc, orderRepo, orderSvc, paymentRepo } = makeEnv({ refundedSum: 2300 });
        paymentRepo.find.mockResolvedValue([{ id: 9, amount: 2300, state: 'Settled' }]);
        orderRepo.findOne.mockResolvedValue(exceptionOrder(7, 'A7'));
        await expect(svc.handleException(ctx, 7 as any, 'refund_diff', 100)).rejects.toThrow('无可退支付余额');
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
    });

    it('refund_diff 金额 ≤0 / 无支付记录 → 拒绝', async () => {
        const { svc, orderRepo, paymentRepo } = makeEnv({ payment: null });
        orderRepo.findOne.mockResolvedValue(exceptionOrder(7, 'A7'));
        await expect(svc.handleException(ctx, 7 as any, 'refund_diff', 0)).rejects.toThrow('赔付金额必须大于 0');
        paymentRepo.find.mockResolvedValue([]);
        await expect(svc.handleException(ctx, 7 as any, 'refund_diff', 300)).rejects.toThrow('无可退支付余额');
    });

    it('refund_diff 赔付额超过订单实付 → 拒绝（防越权超额退款）', async () => {
        const { svc, orderRepo, orderSvc } = makeEnv({ payment: { id: 9, amount: 2300 }, refundedSum: 0 });
        orderRepo.findOne.mockResolvedValue(exceptionOrder(7, 'A7'));
        await expect(svc.handleException(ctx, 7 as any, 'refund_diff', 2301)).rejects.toThrow('赔付金额不能超过订单实付金额');
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
    });

    it('coupon：发补偿券 + exception_final 留痕', async () => {
        const { svc, orderRepo, hallSvc } = makeEnv();
        orderRepo.findOne.mockResolvedValue(exceptionOrder(8, 'A8'));
        (svc as any).couponSvc = { grantCoupon: vi.fn().mockResolvedValue(['CODE1']) };
        await svc.handleException(ctx, 8 as any, 'coupon', undefined, '9' as any, '无骑手补偿');
        expect((svc as any).couponSvc.grantCoupon).toHaveBeenCalledWith(ctx, '9', [160]);
        const patch = hallSvc.transitionFrom.mock.calls[0][3];
        expect(patch).toEqual(expect.objectContaining({
            exceptionAction: 'coupon', exceptionCouponTemplateId: '9', hallStatus: 'exception_final',
        }));
    });

    it('coupon 未选模板 → 拒绝', async () => {
        const { svc, orderRepo } = makeEnv();
        orderRepo.findOne.mockResolvedValue(exceptionOrder(8, 'A8'));
        await expect(svc.handleException(ctx, 8 as any, 'coupon')).rejects.toThrow('请选择补偿券模板');
    });

    it('refund_all：退剩余全额 + cancelOrder + campusCause=exception_refund', async () => {
        const { svc, orderRepo, hallSvc, orderSvc, paymentRepo } = makeEnv({ refundedSum: 300 });
        paymentRepo.find.mockResolvedValue([{ id: 9, amount: 2300, state: 'Settled' }]);
        orderRepo.findOne.mockResolvedValue(exceptionOrder(10, 'A10'));
        await svc.handleException(ctx, 10 as any, 'refund_all');
        // 已退 300，剩余 2000 补退
        expect(orderSvc.refundOrder).toHaveBeenCalledWith(ctx, expect.objectContaining({ paymentId: 9, amount: 2000 }));
        expect(orderSvc.cancelOrder).toHaveBeenCalledWith(ctx, expect.objectContaining({ orderId: 10 }));
        const patch = hallSvc.transitionFrom.mock.calls[0][3];
        expect(patch).toEqual(expect.objectContaining({
            exceptionAction: 'refund_all', hallStatus: 'exception_final', campusCause: 'exception_refund',
        }));
    });

    it('处置完结 push（plan 3.4 补全）：按 action 带对应动态文案通知 exceptionHandled', async () => {
        const { svc, orderRepo, notifySvc } = makeEnv();
        orderRepo.findOne.mockResolvedValue(exceptionOrder(11, 'A11'));
        (svc as any).couponSvc = { grantCoupon: vi.fn().mockResolvedValue(['CODE1']) };
        await svc.handleException(ctx, 11 as any, 'coupon', undefined, '9' as any, '补偿');
        expect(notifySvc.user).toHaveBeenCalledWith(ctx, 11, 'exceptionHandled', '异常已处理，补偿券已发放', undefined, expect.any(String));

        const env2 = makeEnv({ payment: { id: 9, amount: 2300 }, refundedSum: 0 });
        env2.orderRepo.findOne.mockResolvedValue(exceptionOrder(12, 'A12'));
        await env2.svc.handleException(ctx, 12 as any, 'refund_diff', 300);
        expect(env2.notifySvc.user).toHaveBeenCalledWith(ctx, 12, 'exceptionHandled', '异常已处理，差价原路退回', undefined, expect.any(String));
    });

    it('同一单第二次异常处置 → dedupe 后缀不同（固定键会吞掉后续通知）', async () => {
        const env1 = makeEnv();
        env1.orderRepo.findOne.mockResolvedValue(
            exceptionOrder(21, 'A21', { exceptionReportedAt: new Date('2026-10-24T01:00:00Z') }),
        );
        await env1.svc.handleException(ctx, 21 as any, 'reassign');
        const env2 = makeEnv();
        env2.orderRepo.findOne.mockResolvedValue(
            exceptionOrder(21, 'A21', { exceptionReportedAt: new Date('2026-10-24T02:00:00Z') }),
        );
        await env2.svc.handleException(ctx, 21 as any, 'reassign');
        const key1 = env1.notifySvc.user.mock.calls[0][5];
        const key2 = env2.notifySvc.user.mock.calls[0][5];
        expect(key1).toBe('1792803600000');
        expect(key2).not.toBe(key1);
    });

    it('refund_all：已送达异常单 → 入口跳过退款与取消（不再由守卫拦截）', async () => {
        const { svc, orderRepo, orderSvc } = makeEnv({ refundedSum: 300 });
        orderRepo.findOne.mockResolvedValue(
            exceptionOrder(17, 'A17', { hallStatus: 'exception_final', deliveredAt: new Date() }),
        );
        await svc.handleException(ctx, 17 as any, 'refund_all');
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
        expect(orderSvc.cancelOrder).not.toHaveBeenCalled();
    });

    it('已取消订单 → 拒绝处置（防取消后退款/发券）', async () => {
        const { svc, orderRepo } = makeEnv();
        orderRepo.findOne.mockResolvedValue({ ...exceptionOrder(13, 'A13'), state: 'Cancelled' });
        await expect(svc.handleException(ctx, 13 as any, 'refund_all')).rejects.toThrow('订单已取消，无法处置');
    });

    it('重复/并发处置 → 认领失败直接拒绝（不二次退款/发券）', async () => {
        const { svc, orderRepo, rawQuery, orderSvc } = makeEnv();
        orderRepo.findOne.mockResolvedValue(exceptionOrder(14, 'A14'));
        rawQuery.mockResolvedValueOnce([]); // 异常态已被另一路消费
        await expect(svc.handleException(ctx, 14 as any, 'refund_all')).rejects.toThrow('该异常已处置，请刷新后重试');
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
        expect(orderSvc.cancelOrder).not.toHaveBeenCalled();
    });

    it('退款处置失败 → 置 refund_failed 待人工对账（不回滚成可自动重试态）', async () => {
        const env = makeEnv({ payment: { id: 9, amount: 2300 }, refundedSum: 0 });
        env.orderRepo.findOne.mockResolvedValue(exceptionOrder(15, 'A15'));
        env.orderSvc.refundOrder.mockResolvedValue({ errorCode: 'REFUND_FAILED' });
        await expect(env.svc.handleException(ctx, 15 as any, 'refund_diff', 300)).rejects.toThrow('refundOrder failed');
        // 只写一次条件：exception_final → refund_failed（不再回滚原态，避免掩盖未退款）
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledTimes(1);
        expect(env.hallSvc.transitionFrom).toHaveBeenLastCalledWith(ctx, 15, ['exception_final'], {
            hallStatus: 'refund_failed', campusCause: 'refund_failed',
        });
        expect(env.orderRepo.update).not.toHaveBeenCalled();
    });

    it('发券处置失败 → 回滚认领，异常态保留可重试', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue(exceptionOrder(16, 'A16'));
        (env.svc as any).couponSvc = { grantCoupon: vi.fn().mockRejectedValue(new Error('coupon down')) };
        await expect(env.svc.handleException(ctx, 16 as any, 'coupon', undefined, '9' as any)).rejects.toThrow('coupon down');
        expect(env.hallSvc.transitionFrom).toHaveBeenLastCalledWith(ctx, 16, ['exception_final'], {
            hallStatus: 'grabbed', deliveryStatus: 'exception',
        });
    });
});

// 后台强制回厅（P2-4）：已取货单必须带交接说明，说明与复位字段同语句落库
describe('DispatchAdminService.backToHall 交接说明', () => {
    const ctx = { channelId: 1 } as any;

    it('未取货（assigned）无需说明 → 复位到 open', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue({ id: 7, channels: [{ id: 1 }], customFields: { deliveryStatus: 'assigned' } });
        await expect(env.svc.backToHall(ctx, 7 as any)).resolves.toEqual({ backToHall: true });
        expect(env.hallSvc.backToHall).toHaveBeenCalledWith(ctx, 7, {});
    });

    it('已取货（in_progress）无说明 → 拒绝，不回厅', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue({ id: 7, channels: [{ id: 1 }], customFields: { deliveryStatus: 'in_progress' } });
        await expect(env.svc.backToHall(ctx, 7 as any)).rejects.toThrow('需填写交接说明');
        expect(env.hallSvc.backToHall).not.toHaveBeenCalled();
    });

    it('已取货带说明 → 说明/时间/原因与回厅同语句落库', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue({ id: 7, channels: [{ id: 1 }], customFields: { deliveryStatus: 'in_progress' } });
        await env.svc.backToHall(ctx, 7 as any, '  餐已取出，交回门店  ');
        expect(env.hallSvc.backToHall).toHaveBeenCalledWith(ctx, 7, {
            transferNote: '餐已取出，交回门店',
            transferAt: expect.any(Date),
            campusCause: 'admin_force_back',
        });
    });

    it('订单已取消/已终态（条件写未命中）→ 明确报错', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue({ id: 7, channels: [{ id: 1 }], customFields: {} });
        env.hallSvc.backToHall.mockResolvedValueOnce(false);
        await expect(env.svc.backToHall(ctx, 7 as any)).rejects.toThrow('无法回大厅');
    });
});

// A11 受控出口：已送达单唯一放行路径是带理由的强制取消，且先落审计再取消
describe('DispatchAdminService.forceCancel', () => {
    const ctx = { channelId: 1, activeUserId: 42 } as any;
    const deliveredOrder = {
        id: 4, code: 'A4', state: 'PaymentSettled', channels: [{ id: 1 }],
        customFields: { hallStatus: 'delivered', deliveredAt: new Date() },
    };

    it('带理由 → 放行、写审计、清标记', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue(deliveredOrder);
        await expect(env.svc.forceCancel(ctx, 4 as any, '  对账补正  ')).resolves.toBe(true);
        expect(env.orderSvc.cancelOrder).toHaveBeenCalledWith(ctx, expect.objectContaining({
            orderId: 4, reason: '强制取消：对账补正',
        }));
        const insert = env.rawQuery.mock.calls.find(c => String(c[0]).includes('INSERT INTO campus_order_cancel_audit_log'));
        expect(insert?.[1]).toEqual([4, 'A4', 1, 42, true, '对账补正']);
        const update = env.rawQuery.mock.calls.find(c => String(c[0]).includes('UPDATE campus_order_cancel_audit_log'));
        expect(update?.[1]?.[1]).toBe('ok');
        expect((ctx as any)[FORCE_CANCEL_MARK]).toBeUndefined();
    });

    it('空理由 → 拒绝，不取消、不写审计', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue(deliveredOrder);
        await expect(env.svc.forceCancel(ctx, 4 as any, '   ')).rejects.toThrow('必须填写理由');
        expect(env.orderSvc.cancelOrder).not.toHaveBeenCalled();
        expect(env.rawQuery).not.toHaveBeenCalled();
    });

    it('审计落库失败 → 不执行取消（不允许无审计的强制取消）', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue(deliveredOrder);
        env.rawQuery.mockRejectedValueOnce(new Error('db down'));
        await expect(env.svc.forceCancel(ctx, 4 as any, '补救')).rejects.toThrow('db down');
        expect(env.orderSvc.cancelOrder).not.toHaveBeenCalled();
        expect((ctx as any)[FORCE_CANCEL_MARK]).toBeUndefined();
    });

    it('取消失败 → 审计记 failed，标记清理', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue(deliveredOrder);
        env.orderSvc.cancelOrder.mockResolvedValue({ errorCode: 'ORDER_MODIFICATION_ERROR' });
        await expect(env.svc.forceCancel(ctx, 4 as any, '补救')).rejects.toThrow('取消失败');
        const update = env.rawQuery.mock.calls.find(c => String(c[0]).includes('UPDATE campus_order_cancel_audit_log'));
        expect(update?.[1]?.[1]).toBe('failed');
        expect((ctx as any)[FORCE_CANCEL_MARK]).toBeUndefined();
    });

    it('强制标记能穿过真实守卫（已送达单放行）', async () => {
        const env = makeEnv();
        env.orderRepo.findOne.mockResolvedValue(deliveredOrder);
        env.orderSvc.cancelOrder.mockImplementation(async (c: any) => {
            await (campusCancelGuardProcess.onTransitionStart as any)('PaymentSettled', 'Cancelled', { ctx: c, order: deliveredOrder });
            return {};
        });
        await expect(env.svc.forceCancel(ctx, 4 as any, '守卫联调')).resolves.toBe(true);
    });
});

// 无标记的后台/系统取消已送达单 → 真实守卫必须拒绝
describe('已送达取消守卫与 dispatch 入口', () => {
    it('守卫拒绝 admin 无标记取消已送达单', async () => {
        await expect((campusCancelGuardProcess.onTransitionStart as any)('PaymentSettled', 'Cancelled', {
            ctx: { apiType: 'admin', channelId: 1 } as any,
            order: { customFields: { hallStatus: 'delivered' } },
        })).rejects.toThrow('已拦截后台/系统取消');
    });
});