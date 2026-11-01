// 第13轮 P1/P2-1/P3：改址差额退款必须走 settleRefundOrMarkFailed、台账 refundId 锁内 CAS、改址失败回滚台账
import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';
import { AddressChangeService } from './address-change.service';

interface EnvOpts {
    order?: any;
    zone?: any;
    building?: any;
    /** applyChange 先查改址史（effectiveOldFee）：默认无历史 */
    history?: any;
    updateAffected?: number;
    /** 该顾客的待结清台账行（H4 闸门读取） */
    pendingDiffs?: any[];
}

function makeEnv(opts: EnvOpts = {}) {
    const ledgerRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockResolvedValue(opts.pendingDiffs ?? []),
        update: vi.fn().mockResolvedValue({ affected: opts.updateAffected ?? 1 }),
        save: vi.fn(async (x: any) => ({ id: 99, ...x })),
        delete: vi.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: vi.fn(),
    };
    const order = opts.order ?? {
        id: 10,
        code: 'A10',
        state: 'AddingItems',
        shippingWithTax: 300,
        customer: { id: 5 },
        channels: [{ id: 2, code: 'canteen' }],
        customFields: {},
    };
    const orderRepo = {
        findOne: vi.fn().mockResolvedValue(order),
        createQueryBuilder: () => ({
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getOne: vi.fn().mockResolvedValue(order),
        }),
    };
    const zoneRepo = {
        findOne: vi.fn().mockResolvedValue(opts.zone ?? { id: 3, name: 'B区', fee: 200, channelId: 1 }),
    };
    const buildingRepo = {
        findOne: vi.fn().mockResolvedValue(
            opts.building ?? { id: 7, name: '7栋', zoneId: 3, channelId: 1, lat: 30.1, lng: 120.2 },
        ),
    };
    const cfgRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const paymentRepo = {
        find: vi.fn().mockResolvedValue([{ id: 55, amount: 8800, state: 'Settled' }]),
    };
    const refundRepo = {
        // refundedTotal 聚合
        createQueryBuilder: () => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getRawOne: vi.fn().mockResolvedValue({ sum: '0' }),
        }),
        // settleRefundOrMarkFailed 取 paymentId 作 transactionId
        findOne: vi.fn().mockResolvedValue({ id: 77, paymentId: 7 }),
        update: vi.fn().mockResolvedValue({}),
    };
    const conn = {
        getRepository: vi.fn((_ctx: any, ent: any) => {
            const name = (ent as any)?.name ?? String(ent);
            if (name === 'CampusAddressChange') return ledgerRepo;
            if (name === 'CampusZone') return zoneRepo;
            if (name === 'CampusBuilding') return buildingRepo;
            return orderRepo;
        }),
        rawConnection: {
            getRepository: vi.fn((ent: any) => {
                const name = (ent as any)?.name ?? String(ent);
                if (name === 'Payment') return paymentRepo;
                if (name === 'Refund') return refundRepo;
                if (name === 'CampusFulfillmentConfig') return cfgRepo;
                return ledgerRepo;
            }),
            query: vi.fn().mockResolvedValue([[{ id: 1 }], []]),
            createQueryRunner: () => ({
                connect: vi.fn().mockResolvedValue(undefined),
                query: vi.fn().mockResolvedValue([[{ ok: true }], []]),
                release: vi.fn().mockResolvedValue(undefined),
            }),
        },
    } as any;
    const orderService = {
        refundOrder: vi.fn().mockResolvedValue({ id: 77 }),
        settleRefund: vi.fn().mockResolvedValue({}),
        updateCustomFields: vi.fn().mockResolvedValue(order),
    };
    const thirdParty = { cancel: vi.fn().mockResolvedValue({ ok: true }) };
    const hall = { transitionFrom: vi.fn().mockResolvedValue(true), updateOrder: vi.fn() };
    const svc = new AddressChangeService(
        conn,
        orderService as any,
        { findOneByUserId: vi.fn().mockResolvedValue({ id: 5 }) } as any,
        { listOnlineRiders: vi.fn().mockResolvedValue([]) } as any,
        { user: vi.fn() } as any,
        thirdParty as any,
        {} as any,
        hall as any,
        { pushEvent: vi.fn() } as any,
    );
    return { svc, ledgerRepo, orderService, refundRepo, order, zoneRepo, buildingRepo, cfgRepo, thirdParty, hall };
}

const pendingRow = {
    id: 1,
    channelId: 1,
    orderId: 10,
    orderCode: 'A10',
    diff: -200,
    status: 'pending',
    refundId: null,
};

describe('AddressChangeService.settle 差额退款（第13轮 P1/P2-1）', () => {
    it('结算走 settleRefundOrMarkFailed：传 paymentId 作 transactionId，台账 refundId 锁内 CAS 落库', async () => {
        const env = makeEnv();
        const settled = { ...pendingRow, refundId: 77, status: 'settled' };
        // 调用次序：初始读 → 锁内复查 → 返回最新行
        env.ledgerRepo.findOne
            .mockResolvedValueOnce(pendingRow)
            .mockResolvedValueOnce(pendingRow)
            .mockResolvedValueOnce(settled);

        const out = await env.svc.settle({ channelId: 1, activeUserId: 3 } as any, 1 as any, 'refund', '已退');

        expect(env.orderService.settleRefund).toHaveBeenCalledWith(expect.anything(), { id: 77, transactionId: 7 });
        expect(env.ledgerRepo.update).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1, refundId: expect.anything() }),
            expect.objectContaining({
                refundId: 77,
                status: 'settled',
                settleAction: 'refund',
                settleNote: '已退',
                settledBy: 3,
            }),
        );
        // 禁止再用锁外旧 row 覆盖（原实现 save(row)）
        expect(env.ledgerRepo.save).not.toHaveBeenCalled();
        expect(out).toEqual(settled);
    });

    it('结算失败 → 退款单置 Failed（不占已退额度），台账不写 refundId 且不外抛成功', async () => {
        const env = makeEnv();
        env.ledgerRepo.findOne.mockResolvedValueOnce(pendingRow).mockResolvedValueOnce(pendingRow);
        env.orderService.settleRefund.mockRejectedValueOnce(new Error('gateway down'));

        await expect(env.svc.settle({ channelId: 1 } as any, 1 as any, 'refund')).rejects.toThrow('gateway down');
        expect(env.refundRepo.update).toHaveBeenCalledWith(77, { state: 'Failed' });
        expect(env.ledgerRepo.update).not.toHaveBeenCalled();
    });

    it('CAS 未命中（并发已退款）→ 报重复操作，不覆盖台账', async () => {
        const env = makeEnv({ updateAffected: 0 });
        env.ledgerRepo.findOne.mockResolvedValueOnce(pendingRow).mockResolvedValueOnce(pendingRow);

        await expect(env.svc.settle({ channelId: 1 } as any, 1 as any, 'refund')).rejects.toThrow(
            '该差额已退款，请勿重复操作',
        );
    });

    it('结清备注超 200 字 → 拒绝（settleNote 列 varchar(255)）', async () => {
        const env = makeEnv();
        env.ledgerRepo.findOne.mockResolvedValueOnce(pendingRow);
        await expect(
            env.svc.settle({ channelId: 1 } as any, 1 as any, 'collect', 'x'.repeat(201)),
        ).rejects.toThrow(UserInputError);
        expect(env.ledgerRepo.save).not.toHaveBeenCalled();
        expect(env.orderService.refundOrder).not.toHaveBeenCalled();
    });
});

describe('AddressChangeService.applyChange 台账回滚（第13轮 P3）', () => {
    it('订单地址更新失败 → 删除台账行，避免「已改址待补差额」幽灵记录', async () => {
        const env = makeEnv();
        env.ledgerRepo.findOne.mockResolvedValue(null); // 无改址史
        env.orderService.updateCustomFields.mockRejectedValueOnce(new Error('order update failed'));

        await expect(
            env.svc.changeByCustomer({ channelId: 1, activeUserId: 5 } as any, {
                orderId: 10,
                zoneId: 3,
                buildingId: 7,
            } as any),
        ).rejects.toThrow('order update failed');

        expect(env.ledgerRepo.delete).toHaveBeenCalledWith(99);
        // 改址失败不得通知用户/触发外部快递取消
        expect(env.orderService.updateCustomFields).toHaveBeenCalledTimes(1);
    });
});

describe('AddressChangeService 未结清补差闸门（H4）', () => {
    const row = (over: any = {}) => ({
        id: 1,
        channelId: 1,
        orderId: 20,
        orderCode: 'A20',
        diff: 300,
        status: 'pending',
        refundId: null,
        ...over,
    });
    const call = (env: ReturnType<typeof makeEnv>) =>
        env.svc.changeByCustomer(
            { channelId: 1, activeUserId: 5 } as any,
            { orderId: 10, zoneId: 3, buildingId: 7 } as any,
        );

    it('其它订单累计 3 笔待补收 → 拒绝自助改址，且不写台账/不改订单', async () => {
        const env = makeEnv({ pendingDiffs: [row({ orderId: 20 }), row({ orderId: 21 }), row({ orderId: 22 })] });
        await expect(call(env)).rejects.toThrow('有未结清的改址差价');
        expect(env.ledgerRepo.save).not.toHaveBeenCalled();
        expect(env.orderService.updateCustomFields).not.toHaveBeenCalled();
    });

    it('其它订单累计待补收达到 ¥10 → 拒绝', async () => {
        const env = makeEnv({ pendingDiffs: [row({ orderId: 20, diff: 600 }), row({ orderId: 21, diff: 500 })] });
        await expect(call(env)).rejects.toThrow('有未结清的改址差价');
    });

    it('本单自身的待补收不阻断本单改址（允许顾客纠正地址）', async () => {
        const env = makeEnv({ pendingDiffs: [row({ orderId: 10, diff: 500 })] });
        const out: any = await call(env);
        expect(out.recordId).toBe(99);
        expect(env.ledgerRepo.save).toHaveBeenCalledTimes(1);
    });

    it('未结清差额在阈值内 → 正常改址', async () => {
        const env = makeEnv({ pendingDiffs: [row({ orderId: 20, diff: 200 })] });
        const out: any = await call(env);
        expect(out.recordId).toBe(99);
    });
});

describe('AddressChangeService 外部运力改址重推（G5）', () => {
    it('外部在途改址：取消旧运单后回待推送，并清空异常关闭标记', async () => {
        const env = makeEnv({
            zone: { id: 3, name: 'B区', fee: 200, channelId: 2 },
            building: { id: 7, name: '7栋', zoneId: 3, channelId: 2, lat: 30.1, lng: 120.2 },
            order: {
                id: 10,
                code: 'A10',
                state: 'AddingItems',
                shippingWithTax: 300,
                customer: { id: 5 },
                channels: [{ id: 2, code: 'canteen' }],
                customFields: {
                    hallStatus: 'third_party',
                    deliveryPlan: 'external_courier',
                    thirdPartyState: 'pickup',
                    fulfillmentRoute: 'R2',
                    exceptionResolvedAt: new Date('2026-10-01'),
                },
            },
        });
        // 外部已接单顾客侧锁死，走运营代改（adminChange 允许在途改址）
        await env.svc.adminChange({ channelId: 2, activeUserId: 99 } as any, {
            orderId: 10,
            zoneId: 3,
            buildingId: 7,
            reason: '顾客换宿舍',
        } as any);
        expect(env.thirdParty.cancel).toHaveBeenCalled();
        expect(env.hall.transitionFrom).toHaveBeenCalledWith(
            expect.anything(),
            10,
            ['open', 'pending_dispatch', 'third_party'],
            expect.objectContaining({
                hallStatus: 'pending_dispatch',
                thirdPartyState: 'cancelled',
                // 重新推单视为新的外部履约周期，旧的异常关闭标记必须清空
                exceptionResolvedAt: null,
                campusCause: 'address_changed_repush',
            }),
        );
    });
});
