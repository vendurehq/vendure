import { describe, expect, it, vi } from 'vitest';
import { DispatchJobService } from './dispatch-job.service';

function makeEnv(opts: {
    openOrders?: any[];
    assignedOrders?: any[];
    onlineRiders?: any[];
    cfg?: any;
    refundedSum?: number;
    thirdParty?: any;
    feishu?: any;
    /** R7：外部运单异常自动建工单的 SupportService 桩 */
    support?: any;
    /** 覆盖扫描查询返回（用于构造积压等极端批次），未传时用 open/assigned 拼装 */
    scanOrders?: any[];
}) {
    const grabResults: any[] = [];
    const grabSvc = {
        grabByRider: vi.fn().mockImplementation((_ctx: any, orderId: any, rider: any) => {
            grabResults.push({ orderId, riderId: rider.id });
            return Promise.resolve({ id: orderId });
        }),
    };
    const creditSvc = { adjust: vi.fn().mockResolvedValue(95) };
    const allOrders = [...(opts.openOrders ?? []), ...(opts.assignedOrders ?? [])];
    const scanned = opts.scanOrders ?? allOrders;
    const hallSvc = {
        backToHall: vi.fn().mockResolvedValue(true),
        updateOrder: vi.fn().mockResolvedValue({}),
        // 状态迁移改走条件写（CAS）；默认命中，用例可 mockResolvedValueOnce(false) 模拟并发脱厅
        transitionFrom: vi.fn().mockResolvedValue(true),
        releaseScheduled: vi.fn().mockResolvedValue(true),
    };
    const capacitySvc = { listOnlineRiders: vi.fn().mockResolvedValue(opts.onlineRiders ?? []) };
    const orderRepo = {
        // T4 锁内复查 / 商家拒单复查用：默认回放扫描到的订单快照
        findOne: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(
            scanned.find(o => String(o.id) === String(where?.id)) ?? null,
        )),
        update: vi.fn().mockResolvedValue({}),
        // 扫描按 hallStatus 分桶取数：mock 按 IN (:...statuses) 过滤，模拟真实分桶行为
        createQueryBuilder: () => {
            let statuses: string[] | null = null;
            const qb: any = {
                leftJoin: () => qb,
                where: () => qb,
                andWhere: (_sql: string, params?: any) => {
                    if (Array.isArray(params?.statuses)) statuses = params.statuses;
                    return qb;
                },
                orderBy: () => qb,
                addOrderBy: () => qb,
                limit: () => qb,
                getMany: () => Promise.resolve(
                    scanned.filter(o => !statuses || statuses.includes(String(o.customFields?.hallStatus ?? ''))),
                ),
            };
            return qb;
        },
    };
    const configRepo = { findOne: vi.fn().mockResolvedValue(opts.cfg ?? { autoAssignMinutes: 10, autoRefundMinutes: 30, inProgressSlaMinutes: 45 }) };
    const refundRepo = {
        // 部分退款支付单查询：可退支付单（state 必须是 Settled/Authorized）
        find: vi.fn().mockResolvedValue([{ id: 55, amount: 8800, state: 'Settled' }]),
        createQueryBuilder: () => ({
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            // P1：已退总额排除 Failed
            andWhere: vi.fn().mockReturnThis(),
            getRawOne: vi.fn().mockResolvedValue({ sum: String(opts.refundedSum ?? 0) }),
        }),
        // settleRefundOrMarkFailed 要查 refund 关联的 paymentId 当 transactionId
        findOne: vi.fn().mockResolvedValue({ id: 30, paymentId: 7 }),
        // 结算失败置 Failed
        update: vi.fn().mockResolvedValue({}),
    };
    const conn = {
        getRepository: vi.fn((_ctx: any, ent: any) => {
            const name = (ent as any).name;
            if (name === 'CampusFulfillmentConfig') return configRepo;
            if (name === 'Refund') return refundRepo;
            return orderRepo;
        }),
        rawConnection: {
            getRepository: vi.fn((_ent: any) => refundRepo),
            // 超时赔付闸 CAS（UPDATE ... WHERE timeoutcompensatedat IS NULL RETURNING id）：默认命中
            query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
                // 打包条件写：回放命中的 id（模拟全部仍 open）
                if (String(sql).includes('"customFieldsRoutegroupid"')) {
                    return Promise.resolve([((params?.[1] ?? []) as number[]).map(id => ({ id })), []]);
                }
                return Promise.resolve([[{ id: 30 }], []]);
            }),
            // 退款并发咨询锁 / 扫描多实例锁：默认抢锁成功
            createQueryRunner: () => ({
                connect: vi.fn().mockResolvedValue(undefined),
                query: vi.fn().mockResolvedValue([[{ ok: true }], []]),
                release: vi.fn().mockResolvedValue(undefined),
            }),
        },
    } as any;
    const svc = new DispatchJobService(
        conn, grabSvc as any, hallSvc as any, capacitySvc as any, creditSvc as any, { get: vi.fn() } as any,
        opts.thirdParty ?? undefined,
        opts.feishu ?? undefined,
        undefined,
        undefined,
        opts.support ?? undefined,
    );
    return { svc, grabSvc, creditSvc, hallSvc, capacitySvc, orderRepo, configRepo, grabResults, rawQuery: conn.rawConnection.query };
}

const now = Date.now();
const minAgo = (m: number) => new Date(now - m * 60_000);
// order.createdAt 是 DB now() 写入的 UTC 墙钟；造数时模拟 pg 读回（本地字段 = UTC 墙钟），
// 这样 clock 断言在 TZ=UTC 与 TZ=Asia/Shanghai 下都成立
const dbMinAgo = (m: number) => (minAgo(m));

describe('DispatchJobService.scan', () => {
    it('open 超 autoAssignMinutes → 强派最佳在线骑手', async () => {
        const { svc, grabSvc, grabResults } = makeEnv({
            openOrders: [{ id: 1, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(11) } }],
            onlineRiders: [
                { id: 7, customFields: { riderOnlineAt: minAgo(1), riderCredit: 100 } },
                { id: 8, customFields: { riderOnlineAt: minAgo(1), riderCredit: 90 } },
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(grabResults[0]).toEqual({ orderId: 1, riderId: 7 }); // 信用分高者优先
        expect(grabSvc.grabByRider).toHaveBeenCalledOnce();
    });

    it('低信用分(<60)骑手不参与强派', async () => {
        const { svc, grabResults } = makeEnv({
            openOrders: [{ id: 1, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(11) } }],
            onlineRiders: [{ id: 7, customFields: { riderOnlineAt: minAgo(1), riderCredit: 59 } }],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(grabResults).toHaveLength(0);
    });

    it('T2 轮转派单：多单超时不全部塞给信用最高的一人', async () => {
        const { svc, grabResults } = makeEnv({
            openOrders: [
                { id: 1, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(20) } },
                { id: 2, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(15) } },
            ],
            onlineRiders: [
                { id: 7, customFields: { riderOnlineAt: minAgo(1), riderCredit: 100 } },
                { id: 8, customFields: { riderOnlineAt: minAgo(1), riderCredit: 90 } },
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(grabResults).toEqual([
            { orderId: 1, riderId: 7 }, // 同负载 → 信用高者优先
            { orderId: 2, riderId: 8 }, // 7 已 +1 单，负载更低者接下一单
        ]);
    });

    it('T2 负载均衡：信用最高者已有 2 单在途 → 新超时单派给空闲骑手', async () => {
        const { svc, grabResults } = makeEnv({
            assignedOrders: [
                { id: 2, customFields: { hallStatus: 'grabbed', deliveryStatus: 'assigned', deliveryStaffId: '7', assignedAt: minAgo(5), hallEnteredAt: minAgo(6) } },
                { id: 3, customFields: { hallStatus: 'grabbed', deliveryStatus: 'in_progress', deliveryStaffId: '7', assignedAt: minAgo(5), hallEnteredAt: minAgo(6) } },
            ],
            openOrders: [{ id: 1, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(11) } }],
            onlineRiders: [
                { id: 7, customFields: { riderOnlineAt: minAgo(1), riderCredit: 100 } },
                { id: 8, customFields: { riderOnlineAt: minAgo(1), riderCredit: 90 } },
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(grabResults[0]).toEqual({ orderId: 1, riderId: 8 });
    });

    it('assigned 超 15min 未取货 → 回大厅 + 扣 10 分', async () => {
        const { svc, hallSvc, creditSvc } = makeEnv({
            assignedOrders: [{ id: 2, customFields: { hallStatus: 'grabbed', deliveryStatus: 'assigned', deliveryStaffId: '9', assignedAt: minAgo(16), hallEnteredAt: minAgo(20) } }],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.backToHall).toHaveBeenCalledWith(expect.anything(), 2);
        expect(creditSvc.adjust).toHaveBeenCalledWith(expect.anything(), 9, -10, 'timeout_not_picked', 2);
    });

    it('assigned 未超 15min 不动', async () => {
        const { svc, hallSvc } = makeEnv({
            assignedOrders: [{ id: 2, customFields: { hallStatus: 'grabbed', deliveryStatus: 'assigned', deliveryStaffId: '9', assignedAt: minAgo(5), hallEnteredAt: minAgo(6) } }],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.backToHall).not.toHaveBeenCalled();
    });

    it('A3：派单时交接码就已过期（系统原因）→ 回大厅但不扣骑手信用分', async () => {
        const { svc, hallSvc, creditSvc } = makeEnv({
            assignedOrders: [{
                id: 2, code: 'A2',
                customFields: {
                    hallStatus: 'grabbed', deliveryStatus: 'assigned', deliveryStaffId: '9',
                    assignedAt: minAgo(16), hallEnteredAt: minAgo(20),
                    handoverCode: '1234', handoverCodeAt: minAgo(30),
                },
            }],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.backToHall).toHaveBeenCalledWith(expect.anything(), 2);
        expect(creditSvc.adjust).not.toHaveBeenCalled();
    });

    it('A3：派单时码有效、骑手 15min 仍未取餐（真超时）→ 照常扣分', async () => {
        const { svc, hallSvc, creditSvc } = makeEnv({
            assignedOrders: [{
                id: 2, code: 'A3',
                customFields: {
                    hallStatus: 'grabbed', deliveryStatus: 'assigned', deliveryStaffId: '9',
                    assignedAt: minAgo(16), hallEnteredAt: minAgo(20),
                    handoverCode: '1234', handoverCodeAt: minAgo(16),
                },
            }],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.backToHall).toHaveBeenCalledWith(expect.anything(), 2);
        expect(creditSvc.adjust).toHaveBeenCalledWith(expect.anything(), 9, -10, 'timeout_not_picked', 2);
    });
});

describe('DispatchJobService.scan 预约单放量（plan 3.1）', () => {
    it('scheduledFor 进入 30min 窗口 → releaseScheduled 放量', async () => {
        const { svc, hallSvc } = makeEnv({
            openOrders: [{ id: 11, customFields: { hallStatus: 'scheduled', scheduledFor: new Date(now + 10 * 60_000) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 }, // merchantConfirmEnabled 未启用
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.releaseScheduled).toHaveBeenCalledOnce();
        expect(hallSvc.releaseScheduled).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 11 }), expect.anything());
    });

    it('scheduledFor 距今超 30min → 不放量', async () => {
        const { svc, hallSvc } = makeEnv({
            openOrders: [{ id: 11, customFields: { hallStatus: 'scheduled', scheduledFor: new Date(now + 60 * 60_000) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.releaseScheduled).not.toHaveBeenCalled();
    });

    it('商家确认模式渠道 → 放量进入 pending_merchant（走 T2 前不误强派）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 12, customFields: { hallStatus: 'scheduled', scheduledFor: new Date(now + 5 * 60_000) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30, merchantConfirmEnabled: true },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.releaseScheduled).toHaveBeenCalledOnce();
        // 放量后进 pending_merchant，无 open 单，T2 不触发
        expect(env.grabSvc.grabByRider).not.toHaveBeenCalled();
    });

    it('scheduled 缺 scheduledFor → 永不放量（脏数据保护）', async () => {
        const { svc, hallSvc } = makeEnv({
            openOrders: [{ id: 13, customFields: { hallStatus: 'scheduled' } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.releaseScheduled).not.toHaveBeenCalled();
    });
});

/** 预注入 T4 依赖的惰性私有服务（绕过 lazy init，injector 不会被真调） */
function injectT4Services(svc: DispatchJobService) {
    svc['orderSvc'] = {
        refundOrder: vi.fn().mockResolvedValue({ id: 77 }),
        settleRefund: vi.fn().mockResolvedValue({}),
        cancelOrder: vi.fn().mockResolvedValue({ id: 4 }),
    } as any;
    svc['couponSvc'] = { grantCoupon: vi.fn().mockResolvedValue([]) };
}

describe('DispatchJobService.scan 异常超时升级', () => {
    it('异常上报超 SLA 未处置 → 只升级人工介入告警，不回大厅、不改状态', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc, hallSvc } = makeEnv({
            openOrders: [{
                id: 9, code: 'E1', createdAt: dbMinAgo(90),
                customFields: { hallStatus: 'grabbed', deliveryStatus: 'exception', exceptionReportedAt: minAgo(60) },
            }],
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.backToHall).not.toHaveBeenCalled();
        // 餐可能仍在骑手手上：禁止自动回厅/改状态，只进人工介入队列
        expect(hallSvc.transitionFrom).not.toHaveBeenCalled();
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'exception_manual:E1:2');
        expect(call).toBeDefined();
        expect(call![1]).toBe('异常超时待人工介入');
    });

    it('异常上报未超 SLA → 保持不动', async () => {
        const { svc, hallSvc } = makeEnv({
            openOrders: [{
                id: 9, code: 'E1', createdAt: dbMinAgo(30),
                customFields: { hallStatus: 'grabbed', deliveryStatus: 'exception', exceptionReportedAt: minAgo(10) },
            }],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).not.toHaveBeenCalled();
    });
});

describe('DispatchJobService.scan T4 自动退款', () => {
    it('open 超 autoRefundMinutes → 退款 + Cancelled + cause=no_rider + 补偿券', async () => {
        const env = makeEnv({
            openOrders: [{ id: 4, code: 'T4', customerId: 501, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(31) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30, compensationCouponTemplateId: '9' },
        });
        injectT4Services(env.svc);
        const orderSvc = (env.svc as any).orderSvc;
        const couponSvc = (env.svc as any).couponSvc;
        await env.svc.scan({ channelId: 1 } as any);
        expect(orderSvc.refundOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            paymentId: 55,
            amount: 8800,
            shipping: 0, // fork refund 表 shipping/adjustment 列 NOT NULL，必须显式传 0
            adjustment: 0,
        }));
        expect(orderSvc.settleRefund).toHaveBeenCalledOnce();
        expect(orderSvc.cancelOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: 4 }));
        expect(couponSvc.grantCoupon).toHaveBeenCalledWith(expect.anything(), '9', [expect.anything()]);
        expect(env.hallSvc.updateOrder).toHaveBeenCalledWith(expect.anything(), 4, expect.objectContaining({
            customFields: expect.objectContaining({ campusCause: 'no_rider', hallStatus: 'no_rider_final' }),
        }));
    });

    it('未配置补偿券模板 → 不发券不报错，退款照常', async () => {
        const env = makeEnv({
            openOrders: [{ id: 4, code: 'T4', customerId: 501, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(31) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        injectT4Services(env.svc);
        await env.svc.scan({ channelId: 1 } as any);
        expect((env.svc as any).couponSvc.grantCoupon).not.toHaveBeenCalled();
        expect((env.svc as any).orderSvc.cancelOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: 4 }));
        expect(env.hallSvc.updateOrder).toHaveBeenCalledWith(expect.anything(), 4, expect.objectContaining({
            customFields: expect.objectContaining({ campusCause: 'no_rider', hallStatus: 'no_rider_final' }),
        }));
    });

    it('幂等重试：上轮已全额退款（transition 失败残留）→ 跳过 refundOrder 只做取消+标记', async () => {
        const env = makeEnv({
            openOrders: [{ id: 4, code: 'T4', customerId: 501, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(31) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 },
            refundedSum: 8800, // 已退全额
        });
        injectT4Services(env.svc);
        const orderSvc = (env.svc as any).orderSvc;
        await env.svc.scan({ channelId: 1 } as any);
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
        expect(orderSvc.settleRefund).not.toHaveBeenCalled();
        expect(orderSvc.cancelOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId: 4 }));
        expect(env.hallSvc.updateOrder).toHaveBeenCalledWith(expect.anything(), 4, expect.objectContaining({
            customFields: expect.objectContaining({ campusCause: 'no_rider', hallStatus: 'no_rider_final' }),
        }));
    });

    it('锁内复查：等锁期间订单已被抢单/取消 → 不退款也不标记', async () => {
        const env = makeEnv({
            openOrders: [{ id: 4, code: 'T4', customerId: 501, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(31) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        injectT4Services(env.svc);
        const orderSvc = (env.svc as any).orderSvc;
        env.orderRepo.findOne.mockResolvedValueOnce({ id: 4, customFields: { hallStatus: 'grabbed' } });
        await env.svc.scan({ channelId: 1 } as any);
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalledWith(expect.anything(), 4, expect.anything());
    });

    it('补偿券发放失败 → 退款/取消照常成功并推飞书告警（不误记退款失败）', async () => {
        const feishu = { pushEvent: vi.fn() };
        const env = makeEnv({
            openOrders: [{ id: 4, code: 'T4', customerId: 501, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(31) } }],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30, compensationCouponTemplateId: '9' },
            feishu,
        });
        injectT4Services(env.svc);
        (env.svc as any).couponSvc.grantCoupon.mockRejectedValueOnce(new Error('template disabled'));
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.updateOrder).toHaveBeenCalledWith(expect.anything(), 4, expect.objectContaining({
            customFields: expect.objectContaining({ campusCause: 'no_rider', hallStatus: 'no_rider_final' }),
        }));
        expect(env.hallSvc.transitionFrom).not.toHaveBeenCalledWith(
            expect.anything(), 4, ['open'], expect.objectContaining({ hallStatus: 'refund_failed' }),
        );
        expect(feishu.pushEvent).toHaveBeenCalledWith(
            'alert',
            '无人接单补偿券发放失败',
            expect.stringContaining('T4'),
            'T4',
            'compensation_coupon_failed:T4',
        );
    });

    it('单笔退款异常不阻断本轮其余订单（逐单隔离）', async () => {
        const env = makeEnv({
            openOrders: [
                { id: 4, code: 'T4A', customerId: 501, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(31) } },
                { id: 5, code: 'T4B', customerId: 502, customFields: { hallStatus: 'open', hallEnteredAt: minAgo(32) } },
            ],
            cfg: { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        injectT4Services(env.svc);
        const refundSpy = vi.spyOn(env.svc as any, 'refundNoRider').mockRejectedValueOnce(new Error('refund boom'));
        await env.svc.scan({ channelId: 1 } as any);
        expect(refundSpy).toHaveBeenCalledTimes(2); // 第二单仍继续处理
    });
});

describe('DispatchJobService.scan 多单顺路打包 T1.5（plan 3.3）', () => {
    const fresh = (id: number, cf: any) => ({
        id,
        createdAt: dbMinAgo(20),
        customFields: { hallStatus: 'open', hallEnteredAt: minAgo(1), fulfillmentRoute: 'R1', ...cf },
    });
    // 打包已改裸 SQL 条件写：从 rawConnection.query 调用中筛出 routeGroupId 写入
    const packCalls = (rawQuery: any) =>
        (rawQuery.mock.calls as any[][]).filter((c: any[]) => String(c[0]).includes('"customFieldsRoutegroupid"'));

    it('同楼栋+同时段 2 单 → 写同一 routeGroupId', async () => {
        const { svc, rawQuery } = makeEnv({
            openOrders: [
                fresh(1, { buildingId: 'b1', deliverySlotId: '11', deliverySlotText: '11:00-11:30' }),
                fresh(2, { buildingId: 'b1', deliverySlotId: '11', deliverySlotText: '11:00-11:30' }),
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        const calls = packCalls(rawQuery);
        expect(calls).toHaveLength(1);
        const [sql, params] = calls[0];
        // 条件写：仅 open 且未取消的单
        expect(String(sql)).toContain('"customFieldsHallstatus" = $3');
        expect(params[1]).toEqual([1, 2]);
        expect(params[2]).toBe('open');
        expect(params[0]).toMatch(/^rg-/);
    });

    it('不同楼栋不成组', async () => {
        const { svc, rawQuery } = makeEnv({
            openOrders: [
                fresh(1, { buildingId: 'b1', deliverySlotId: '11' }),
                fresh(2, { buildingId: 'b2', deliverySlotId: '11' }),
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(packCalls(rawQuery)).toHaveLength(0);
    });

    it('即时单同楼栋入厅差 ≤10min 成组，超窗不成组', async () => {
        const near = { id: 1, createdAt: dbMinAgo(20), customFields: { hallStatus: 'open', fulfillmentRoute: 'R1', buildingId: 'b1', hallEnteredAt: minAgo(9) } };
        const near2 = { id: 2, createdAt: dbMinAgo(19), customFields: { hallStatus: 'open', fulfillmentRoute: 'R1', buildingId: 'b1', hallEnteredAt: minAgo(1) } };
        const far = { id: 3, createdAt: dbMinAgo(40), customFields: { hallStatus: 'open', fulfillmentRoute: 'R1', buildingId: 'b1', hallEnteredAt: minAgo(30) } };
        const env = makeEnv({ openOrders: [near, near2, far] });
        await env.svc.scan({ channelId: 1 } as any);
        const [, ids] = packCalls(env.rawQuery)[0][1];
        expect([...ids].sort()).toEqual([1, 2]); // far 单差 29min 不入组
    });

    it('errand 跑腿单不打包', async () => {
        const { svc, rawQuery } = makeEnv({
            openOrders: [
                fresh(1, { buildingId: 'b1' }),
                fresh(2, { buildingId: 'b1', fulfillmentRoute: undefined, orderKind: 'errand' }),
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        expect(packCalls(rawQuery)).toHaveLength(0);
    });

    it('批内已有 routeGroupId → 复用不重生成', async () => {
        const { svc, rawQuery } = makeEnv({
            openOrders: [
                fresh(1, { buildingId: 'b1', deliverySlotId: '11', routeGroupId: 'rg-old' }),
                fresh(2, { buildingId: 'b1', deliverySlotId: '11' }),
            ],
        });
        await svc.scan({ channelId: 1 } as any);
        const calls = packCalls(rawQuery);
        expect(calls).toHaveLength(1);
        const [, params] = calls[0];
        expect(params[0]).toBe('rg-old');
        expect(params[1]).toEqual([2]); // 已带组 id 的单不再 update
    });
});

describe('DispatchJobService.scan 路线超时兜底（R1–R3）', () => {
    const cfg = { channelId: 1, autoAssignMinutes: 10, autoRefundMinutes: 30 };

    it('R1 商户接单超时 → 转自营快递池（owned_pool，等待骑手接单）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 21, code: 'R1T', createdAt: dbMinAgo(10), customFields: { hallStatus: 'pending_merchant', fulfillmentRoute: 'R1', deliveryPlan: 'merchant' } }],
            cfg: { ...cfg, merchantAcceptMinutes: 5 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 21, ['pending_merchant'], expect.objectContaining({
            hallStatus: 'owned_pool',
            hallEnteredAt: expect.any(Date),
            deliveryPlan: 'owned',
            // 尚未指派骑手：旧骑手指派/取餐残留必须清空，否则取餐/接单校验误判
            deliveryStaffId: null,
            deliveryStatus: null,
            assignedAt: null,
            pickedUpAt: null,
            campusCause: 'merchant_accept_timeout',
        }));
    });

    it('R2 商户接单超时 → 降级传信者到店取餐直送（open）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 24, code: 'R2A', createdAt: dbMinAgo(10), customFields: { hallStatus: 'pending_merchant', fulfillmentRoute: 'R2', deliveryPlan: 'external_courier' } }],
            cfg: { ...cfg, merchantAcceptMinutes: 5 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 24, ['pending_merchant'], expect.objectContaining({
            hallStatus: 'open',
            deliveryPlan: 'campus_rider',
            campusCause: 'merchant_accept_timeout',
        }));
    });

    it('R2 已接单但久未出餐 → 降级传信者到店取餐直送（open）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 25, code: 'R2C', createdAt: dbMinAgo(40), customFields: { hallStatus: 'accepted', fulfillmentRoute: 'R2', deliveryPlan: 'external_courier' } }],
            cfg: { ...cfg, merchantAutoOpenMinutes: 15 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 25, ['accepted'], expect.objectContaining({
            hallStatus: 'open',
            deliveryPlan: 'campus_rider',
            campusCause: 'merchant_cooking_timeout',
        }));
    });

    it('R1 已接单但久未出餐（确认模式关闭遗留单）→ 同样回大厅兜底', async () => {
        const env = makeEnv({
            openOrders: [{ id: 26, code: 'R1C', createdAt: dbMinAgo(40), customFields: { hallStatus: 'accepted', fulfillmentRoute: 'R1', deliveryPlan: 'merchant' } }],
            cfg: { ...cfg, merchantAutoOpenMinutes: 15 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 26, ['accepted'], expect.objectContaining({
            hallStatus: 'open',
            deliveryPlan: 'campus_rider',
            handoverMode: '',
            campusCause: 'merchant_cooking_timeout',
        }));
    });

    it('R1 商户久未送达交接点 → 回大厅由传信者取餐', async () => {
        const env = makeEnv({
            openOrders: [{ id: 22, code: 'R1D', createdAt: dbMinAgo(40), customFields: { hallStatus: 'merchant_delivering', fulfillmentRoute: 'R1', deliveryPlan: 'merchant', assignedAt: minAgo(20) } }],
            cfg: { ...cfg, merchantAutoOpenMinutes: 15 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 22, ['merchant_delivering'], expect.objectContaining({
            hallStatus: 'open',
            deliveryPlan: 'campus_rider',
            campusCause: 'merchant_deliver_timeout',
        }));
    });

    it('R2 迟迟未推送外部快递 → 回大厅', async () => {
        const env = makeEnv({
            openOrders: [{ id: 23, code: 'R2P', createdAt: dbMinAgo(30), customFields: { hallStatus: 'pending_dispatch', fulfillmentRoute: 'R2', deliveryPlan: 'external_courier' } }],
            cfg: { ...cfg, externalPushTimeoutMinutes: 10 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 23, ['pending_dispatch'], expect.objectContaining({
            hallStatus: 'open', campusCause: 'external_push_timeout',
        }));
    });

    it('R3 外部快递久未接单 → 取消并回抢单大厅；R2 回待推送', async () => {
        const env = makeEnv({
            openOrders: [
                { id: 24, code: 'R3F', createdAt: dbMinAgo(40), customFields: { hallStatus: 'third_party', fulfillmentRoute: 'R3', deliveryPlan: 'external_courier', thirdPartyDispatchAt: minAgo(30) } },
                { id: 25, code: 'R2F', createdAt: dbMinAgo(40), customFields: { hallStatus: 'third_party', fulfillmentRoute: 'R2', deliveryPlan: 'external_courier', thirdPartyDispatchAt: minAgo(30) } },
            ],
            cfg: { ...cfg, externalFallbackMinutes: 20 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 24, ['third_party'], expect.objectContaining({
            hallStatus: 'open', campusCause: 'external_fallback',
        }));
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 25, ['third_party'], expect.objectContaining({
            hallStatus: 'pending_dispatch', campusCause: 'external_fallback',
        }));
    });

    it('外部取消失败 → 保持 third_party 不回落重推（防双运单双份运费）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 30, code: 'R3C', createdAt: dbMinAgo(40), customFields: { hallStatus: 'third_party', fulfillmentRoute: 'R3', deliveryPlan: 'external_courier', thirdPartyDispatchAt: minAgo(30) } }],
            cfg: { ...cfg, externalFallbackMinutes: 20 },
        });
        // 注入外部网关：取消返回失败
        (env.svc as any).thirdParty = { cancel: vi.fn().mockResolvedValue({ ok: false, reason: 'platform busy' }) };
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 30, ['third_party'], {
            campusCause: 'external_cancel_failed',
        });
        expect(env.hallSvc.transitionFrom).not.toHaveBeenCalledWith(
            expect.anything(), 30, ['third_party'], expect.objectContaining({ hallStatus: 'open' }),
        );
    });

    it('外部已接单/取货 → 超 fallback 也不取消（避免干掉在途骑手）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 26, code: 'R2A', createdAt: dbMinAgo(60), customFields: { hallStatus: 'third_party', fulfillmentRoute: 'R2', deliveryPlan: 'external_courier', thirdPartyDispatchAt: minAgo(30), thirdPartyState: 'accepted' } }],
            cfg: { ...cfg, externalFallbackMinutes: 20 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).not.toHaveBeenCalled();
    });

    it('外部接单后超 3×fallback → 硬上限仍取消回落', async () => {
        const env = makeEnv({
            openOrders: [{ id: 27, code: 'R3A', createdAt: dbMinAgo(90), customFields: { hallStatus: 'third_party', fulfillmentRoute: 'R3', deliveryPlan: 'external_courier', thirdPartyDispatchAt: minAgo(70), thirdPartyState: 'pickup' } }],
            cfg: { ...cfg, externalFallbackMinutes: 20 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 27, ['third_party'], expect.objectContaining({
            hallStatus: 'open', campusCause: 'external_fallback',
        }));
    });

    it('自营快递池久无人接单 → 回抢单大厅（传信者兜底）', async () => {
        const env = makeEnv({
            openOrders: [{ id: 28, code: 'R3O', createdAt: dbMinAgo(40), customFields: { hallStatus: 'owned_pool', fulfillmentRoute: 'R3', deliveryPlan: 'owned' } }],
            cfg: { ...cfg, merchantAutoOpenMinutes: 15 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 28, ['owned_pool'], expect.objectContaining({
            hallStatus: 'open', campusCause: 'owned_pool_timeout',
        }));
    });

    it('自营快递已派出久未送达 → 回抢单大厅并清空骑手', async () => {
        const env = makeEnv({
            openOrders: [{ id: 29, code: 'R1O', createdAt: dbMinAgo(60), customFields: { hallStatus: 'owned_dispatched', fulfillmentRoute: 'R1', deliveryPlan: 'owned', assignedAt: minAgo(20), deliveryStaffId: '9' } }],
            cfg: { ...cfg, merchantAutoOpenMinutes: 15 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledWith(expect.anything(), 29, ['owned_dispatched'], expect.objectContaining({
            hallStatus: 'open', campusCause: 'owned_deliver_timeout',
            deliveryStaffId: null, assignedAt: null,
        }));
    });

    it('预约单刚放量：按 hallEnteredAt 计时，不被 createdAt 误判商家超时', async () => {
        const env = makeEnv({
            openOrders: [{
                id: 31, code: 'SCH', createdAt: dbMinAgo(300), // 预约单很早下单
                customFields: { hallStatus: 'scheduled', fulfillmentRoute: 'R1', scheduledFor: new Date(now + 10 * 60_000) },
            }],
            cfg: { ...cfg, merchantAcceptMinutes: 5 },
        });
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.releaseScheduled).toHaveBeenCalledOnce();
        // 放量后锚点为当前时刻：不应同一轮触发 merchant_accept_timeout
        expect(env.hallSvc.transitionFrom).not.toHaveBeenCalled();
    });

    it('CAS 未命中（并发取消/已改派）→ 跳过且不再继续后续兜底', async () => {
        const env = makeEnv({
            openOrders: [{ id: 32, code: 'CAS', createdAt: dbMinAgo(40), customFields: { hallStatus: 'owned_pool', fulfillmentRoute: 'R3', deliveryPlan: 'owned' } }],
            cfg: { ...cfg, merchantAutoOpenMinutes: 15 },
        });
        env.hallSvc.transitionFrom.mockResolvedValueOnce(false);
        await env.svc.scan({ channelId: 1 } as any);
        expect(env.hallSvc.transitionFrom).toHaveBeenCalledOnce();
    });
});

/** 超时赔付专用环境：绕过 scan 的混合查询，直接替换仓库返回待判定送达单 */
function makeTimeoutEnv(opts: {
    orders: any[];
    cfg?: any;
    coupon?: { grantCoupon: any } | null;
}) {
    const env = makeEnv({ cfg: { channelId: 1, ...opts.cfg } });
    const repo = {
        createQueryBuilder: vi.fn(() => ({
            leftJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            addOrderBy: vi.fn().mockReturnThis(),
            take: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(opts.orders),
        })),
    };
    // 券服务 mock 需固定实例（services() 每次调用都会重建对象，不能在里面新建 spy）
    const coupon = opts.coupon === null ? null : (opts.coupon ?? { grantCoupon: vi.fn().mockResolvedValue(['coupon-1']) });
    const baseConn = (env.svc as any).connection;
    (env.svc as any).connection = { getRepository: vi.fn(() => repo), rawConnection: baseConn.rawConnection };
    (env.svc as any).services = () => ({ order: null, coupon });
    return { ...env, coupon, repo, rawQuery: baseConn.rawConnection.query as any };
}

describe('DispatchJobService 超时赔付（P0）', () => {
    const cfgOn = { timeoutCompensationEnabled: true, timeoutGraceMinutes: 10, timeoutCompensationCouponTemplateId: 'T-LATE' };
    const deliveredOrder = (over: any = {}) => ({
        id: 31, code: 'TO1', customerId: '5', createdAt: dbMinAgo(60),
        customFields: {
            promisedAt: new Date(now - 25 * 60_000), deliveredAt: new Date(now),
            assignedAt: minAgo(58), // 下单 60min 前、接单 58min 前 → 在途占比更长，归因 rider
            ...over,
        },
    });

    it('超出承诺 + 宽限 → 先抢赔付闸（CAS）再发券并写归因', async () => {
        const env = makeTimeoutEnv({ orders: [deliveredOrder()], cfg: cfgOn });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        // 先认领闸：UPDATE ... WHERE timeoutcompensatedat IS NULL（或过期僵死认领）RETURNING id
        expect(env.rawQuery).toHaveBeenCalledWith(
            expect.stringContaining('"customFieldsTimeoutcompensatedat" IS NULL'),
            [expect.any(Date), 31, expect.any(Date)],
        );
        expect(env.coupon!.grantCoupon).toHaveBeenCalledWith(
            expect.anything(), 'T-LATE', ['5'],
        );
        expect(env.hallSvc.updateOrder).toHaveBeenCalledWith(expect.anything(), 31, {
            customFields: expect.objectContaining({
                timeoutLateMinutes: 25,
                timeoutCompensationCouponId: 'coupon-1',
                timeoutAttribution: 'rider',
            }),
        });
        // 闸已在认领时写入，最终留痕不重复写（避免覆盖认领时间）
        expect(env.hallSvc.updateOrder.mock.calls[0][2].customFields.timeoutCompensatedAt).toBeUndefined();
    });

    it('赔付闸已被上一轮抢占（认领失败）→ 不发券', async () => {
        const env = makeTimeoutEnv({ orders: [deliveredOrder()], cfg: cfgOn });
        env.rawQuery.mockResolvedValueOnce([[], []]);
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        expect(env.coupon!.grantCoupon).not.toHaveBeenCalled();
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalled();
    });

    it('超时未过宽限 → 不赔', async () => {
        const env = makeTimeoutEnv({
            orders: [deliveredOrder({ promisedAt: new Date(now - 8 * 60_000) })], cfg: cfgOn,
        });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalled();
    });

    it('接单前耗时更长 → 归因 merchant', async () => {
        const env = makeTimeoutEnv({
            orders: [deliveredOrder({ assignedAt: minAgo(5), deliveredAt: new Date(now - 40 * 60_000), promisedAt: new Date(now - 70 * 60_000) })],
            cfg: cfgOn,
        });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        expect(env.hallSvc.updateOrder.mock.calls[0][2].customFields.timeoutAttribution).toBe('merchant');
    });

    it('全程无骑手承接 → 归因 platform', async () => {
        const env = makeTimeoutEnv({ orders: [deliveredOrder({ assignedAt: null })], cfg: cfgOn });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        expect(env.hallSvc.updateOrder.mock.calls[0][2].customFields.timeoutAttribution).toBe('platform');
    });

    it('开关关闭 → 整轮跳过（不发券不查询）', async () => {
        const env = makeTimeoutEnv({ orders: [deliveredOrder()], cfg: { timeoutCompensationEnabled: false } });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, { timeoutCompensationEnabled: false } as any, now);
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalled();
    });

    it('未配置券模板 → 不发券也不写闸（保留待赔资格）', async () => {
        const env = makeTimeoutEnv({
            orders: [deliveredOrder()],
            cfg: { ...cfgOn, timeoutCompensationCouponTemplateId: null },
        });
        await (env.svc as any).sweepTimeoutCompensation(
            { channelId: 1 } as any, { ...cfgOn, timeoutCompensationCouponTemplateId: null } as any, now,
        );
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalled();
    });

    it('发券异常 → 释放赔付闸，下一轮可重试', async () => {
        const env = makeTimeoutEnv({
            orders: [deliveredOrder()], cfg: cfgOn,
            coupon: { grantCoupon: vi.fn().mockRejectedValue(new Error('template disabled')) },
        });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalled();
        // 认领 + 释放两次 SQL：第二次把闸清空
        expect(env.rawQuery).toHaveBeenCalledTimes(2);
        expect(env.rawQuery.mock.calls[1][0]).toContain('"customFieldsTimeoutcompensatedat" = NULL');
    });

    it('发券返回空数组 → 释放赔付闸、不写留痕（避免空券把闸占死永久漏赔）', async () => {
        const env = makeTimeoutEnv({
            orders: [deliveredOrder()], cfg: cfgOn,
            coupon: { grantCoupon: vi.fn().mockResolvedValue([]) },
        });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        expect(env.hallSvc.updateOrder).not.toHaveBeenCalled();
        expect(env.rawQuery).toHaveBeenCalledTimes(2);
        expect(env.rawQuery.mock.calls[1][0]).toContain('"customFieldsTimeoutcompensatedat" = NULL');
    });

    it('赔付闸过期回收：扫描与认领均允许「券 id 为空且认领超 15min」重新赔付', async () => {
        const env = makeTimeoutEnv({ orders: [deliveredOrder()], cfg: cfgOn });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        const whereSql = env.repo.createQueryBuilder.mock.results[0].value.andWhere.mock.calls
            .map((c: any[]) => String(c[0]))
            .join('\n');
        expect(whereSql).toContain('timeoutCompensationCouponId IS NULL');
        expect(whereSql).toContain('staleBefore');
        expect(env.rawQuery.mock.calls[0][0]).toContain('"customFieldsTimeoutcompensationcouponid" IS NULL');
        const staleBefore = env.rawQuery.mock.calls[0][1][2] as Date;
        expect(now - staleBefore.getTime()).toBe(15 * 60_000);
    });

    it('已全额退款订单在查询层剔除（不参与赔付）', async () => {
        const env = makeTimeoutEnv({ orders: [], cfg: cfgOn });
        await (env.svc as any).sweepTimeoutCompensation({ channelId: 1 } as any, cfgOn, now);
        // 断言扫描 SQL 带「已全额退款排除」子查询（退款单未必是 Cancelled，仅靠 state 过滤不够）
        const whereSql = env.repo.createQueryBuilder.mock.results[0].value.andWhere.mock.calls
            .map((c: any[]) => String(c[0]))
            .join('\n');
        expect(whereSql).toContain('NOT EXISTS');
        expect(whereSql).toContain('"refund"');
    });
});

describe('DispatchJobService.tick 多实例扫描锁', () => {
    it('渠道锁被占用 → 跳过该渠道；其余渠道照常扫描（渠道故障隔离）', async () => {
        const env = makeEnv({});
        const conn = (env.svc as any).connection;
        const channelRepo = { findOne: vi.fn().mockResolvedValue(null) };
        const cfgRepo = { find: vi.fn().mockResolvedValue([{ channelId: 1 }, { channelId: 2 }]) };
        conn.rawConnection.getRepository = vi.fn((ent: any) => ((ent as any).name === 'Channel' ? channelRepo : cfgRepo));
        const mkRunner = (lockOk: boolean) => ({
            connect: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockResolvedValueOnce([[{ ok: lockOk }]]).mockResolvedValue([[]]),
            release: vi.fn().mockResolvedValue(undefined),
        });
        const runners = [mkRunner(false), mkRunner(true)];
        conn.rawConnection.createQueryRunner = vi.fn(() => runners.shift());
        const scanSpy = vi.spyOn(env.svc as any, 'scan').mockResolvedValue({} as any);
        await (env.svc as any).tick();
        expect(scanSpy).toHaveBeenCalledTimes(1);
        expect((scanSpy.mock.calls[0][0] as any).channelId).toBe(2);
    });

    it('单渠道扫描抛错 → 不中断后续渠道', async () => {
        const env = makeEnv({});
        const conn = (env.svc as any).connection;
        const channelRepo = { findOne: vi.fn().mockResolvedValue(null) };
        const cfgRepo = { find: vi.fn().mockResolvedValue([{ channelId: 1 }, { channelId: 2 }]) };
        conn.rawConnection.getRepository = vi.fn((ent: any) => ((ent as any).name === 'Channel' ? channelRepo : cfgRepo));
        conn.rawConnection.createQueryRunner = vi.fn(() => ({
            connect: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockResolvedValueOnce([[{ ok: true }]]).mockResolvedValue([[]]),
            release: vi.fn().mockResolvedValue(undefined),
        }));
        const scanSpy = vi
            .spyOn(env.svc as any, 'scan')
            .mockRejectedValueOnce(new Error('channel 1 boom'))
            .mockResolvedValueOnce({} as any);
        await (env.svc as any).tick();
        expect(scanSpy).toHaveBeenCalledTimes(2);
        expect((scanSpy.mock.calls[1][0] as any).channelId).toBe(2);
    });

    // ---------- P1 提前告警 ----------

    it('grabbed+assigned 骑手 13.5min 未取货 → ⏱ 骑手取货超时提前告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc } = makeEnv({
            // assignedAt 13.5min 前（>=13.5min 提前告警点 且 <15min 兜底点）
            assignedOrders: [{ id: 101, code: 'RIDER_PICK_01', customFields: { hallStatus: 'grabbed', deliveryStatus: 'assigned', assignedAt: minAgo(13.5), deliveryStaffId: 7 } }],
            cfg: { merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10, externalFallbackMinutes: 20, inProgressSlaMinutes: 45, synchronize: false },
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'rider_pick_alert:RIDER_PICK_01');
        expect(call).toBeDefined();
        expect(call![1]).toBe('⏱ 骑手取货超时');
    });

    it('pending_merchant R2 超 4min → ⚠️ 商家即将超时提前告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc } = makeEnv({
            // acceptMs=5min，提前告警点 4min，hallEnteredAt 4min 前
            openOrders: [{ id: 201, code: 'ACCEPT_ALERT_01', customFields: { hallStatus: 'pending_merchant', fulfillmentRoute: 'R2', hallEnteredAt: minAgo(4) } }],
            cfg: { merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10, externalFallbackMinutes: 20, inProgressSlaMinutes: 45, synchronize: false },
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'accept_alert:ACCEPT_ALERT_01');
        expect(call).toBeDefined();
        expect(call![1]).toBe('⚠️ 商家即将超时');
    });

    it('open+exception 超 7.5min → 🚨 异常待处置提前告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc } = makeEnv({
            // SLA=45min，alertMs=45/6=7.5min，exceptionReportedAt 8min 前
            openOrders: [{ id: 301, code: 'EXCEPTION_ALERT_01', customFields: { hallStatus: 'open', deliveryStatus: 'exception', exceptionReportedAt: minAgo(8), exceptionType: '骑手联系不上' } }],
            cfg: { merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10, externalFallbackMinutes: 20, inProgressSlaMinutes: 45, synchronize: false },
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'exception_alert:EXCEPTION_ALERT_01');
        expect(call).toBeDefined();
        expect(call![1]).toBe('🚨 异常待处置');
        expect(call![2]).toContain('骑手联系不上');
    });

    it('third_party 超 17.5min → 📦 外部快递在途超时提前告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc } = makeEnv({
            // fallbackMs=20min，alertMs=20-2.5=17.5min，thirdPartyDispatchAt 18min 前
            openOrders: [{ id: 401, code: 'TP_ALERT_01', customFields: { hallStatus: 'third_party', thirdPartyDispatchAt: minAgo(18), thirdPartyState: 'not_received', fulfillmentRoute: 'R3' } }],
            cfg: { merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10, externalFallbackMinutes: 20, inProgressSlaMinutes: 45, synchronize: false },
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'third_party_alert:TP_ALERT_01');
        expect(call).toBeDefined();
        expect(call![1]).toBe('📦 外部快递在途超时');
        expect(call![2]).toContain('not_received');
    });

    // §6 异常态（回调丢失后由对账/轮询发现）：必须告警且同一运单只推一次
    it('third_party 异常态 → 外部运单异常告警（同一运单号去重）', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc } = makeEnv({
            openOrders: [{ id: 402, code: 'TP_EXC_01', customFields: { hallStatus: 'third_party', thirdPartyDispatchAt: minAgo(2), thirdPartyState: 'exception', thirdPartyNo: 'TP-EXC', fulfillmentRoute: 'R3' } }],
            cfg: { merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10, externalFallbackMinutes: 20, inProgressSlaMinutes: 45, synchronize: false },
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        const dedupe = (c: any[]) => c[4] === 'TP_EXC_01:external_exception';
        expect(feishu.pushEvent.mock.calls.filter(dedupe)).toHaveLength(1);
        expect(feishu.pushEvent.mock.calls.find(dedupe)![1]).toBe('外部运单异常');
        // 异常未恢复 → 下一轮仍只推一次
        await svc.scan({ channelId: 1 } as any);
        expect(feishu.pushEvent.mock.calls.filter(dedupe)).toHaveLength(1);
    });

    // F5：兜底不能受 merchantConfirmEnabled 开关影响，否则关开关后存量单永久卡死
    it('R3 商家确认开关关闭后，存量 pending_merchant 仍有超时出口', async () => {
        const { svc, hallSvc } = makeEnv({
            scanOrders: [{
                id: 11, code: 'R3_STALE', createdAt: dbMinAgo(40),
                customFields: { hallStatus: 'pending_merchant', hallEnteredAt: minAgo(40), fulfillmentRoute: 'R3' },
            }],
            cfg: { merchantConfirmEnabled: false, merchantAutoOpenMinutes: 15, autoAssignMinutes: 10, autoRefundMinutes: 30, inProgressSlaMinutes: 45 },
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).toHaveBeenCalledWith(
            expect.anything(), 11, ['pending_merchant', 'accepted'],
            expect.objectContaining({ hallStatus: 'open', campusCause: 'merchant_timeout' }),
        );
    });

    // F6：回落重推后计时锚要刷新，旧 assignedAt 不能让重推窗口瞬间失效
    it('R2 回落重推后不被旧 assignedAt 立即再次判超时', async () => {
        const { svc, hallSvc } = makeEnv({
            scanOrders: [{
                id: 12, code: 'R2_RETRY', createdAt: dbMinAgo(80),
                customFields: {
                    hallStatus: 'pending_dispatch', fulfillmentRoute: 'R2',
                    assignedAt: minAgo(60), thirdPartyDispatchAt: minAgo(1), hallEnteredAt: minAgo(70),
                },
            }],
            cfg: { externalPushTimeoutMinutes: 10, merchantAutoOpenMinutes: 15, inProgressSlaMinutes: 45, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).not.toHaveBeenCalled();
    });

    // F13：scheduledFor 缺失/脏数据 → 转入大厅并告警，不能永久停在 scheduled
    it('scheduled 缺少有效 scheduledFor → 转 open 并告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc, hallSvc } = makeEnv({
            scanOrders: [{
                id: 13, code: 'SCHED_BAD', createdAt: dbMinAgo(60),
                customFields: { hallStatus: 'scheduled', scheduledFor: null },
            }],
            feishu,
            cfg: { merchantAutoOpenMinutes: 15, autoAssignMinutes: 10, autoRefundMinutes: 30, inProgressSlaMinutes: 45 },
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).toHaveBeenCalledWith(
            expect.anything(), 13, ['scheduled'],
            expect.objectContaining({ hallStatus: 'open', campusCause: 'scheduled_missing_time' }),
        );
        expect(feishu.pushEvent).toHaveBeenCalled();
    });

    // F7：骑手已取货超 2×SLA → 只升级人工介入告警，不改状态（餐在骑手手上，防丢餐）
    it('骑手已取货超 2×SLA → 只告警不改状态', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc, hallSvc } = makeEnv({
            scanOrders: [{
                id: 14, code: 'RIDER_LOST', createdAt: dbMinAgo(120),
                customFields: { hallStatus: 'grabbed', deliveryStatus: 'in_progress', deliveryStaffId: '7', assignedAt: minAgo(100) },
            }],
            feishu,
            cfg: { inProgressSlaMinutes: 45, merchantAutoOpenMinutes: 15, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).not.toHaveBeenCalled();
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'rider_manual:RIDER_LOST:3');
        expect(call).toBeDefined();
        expect(call![1]).toBe('骑手配送超时待人工介入');
    });

    // F4：外部取消失败连续多轮 → 升级飞书异常，但绝不自动回落（避免双运单双份运费）
    it('外部取消失败连续 3 轮 → 飞书告警且保持 third_party', async () => {
        const feishu = { pushEvent: vi.fn() };
        const thirdParty = {
            syncStatus: vi.fn().mockResolvedValue({ ok: true, state: 'pending' }),
            onDeliveryStatus: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue({ ok: false }),
        };
        const { svc, hallSvc } = makeEnv({
            scanOrders: [{
                id: 15, code: 'TP_CANCEL_FAIL', createdAt: dbMinAgo(200),
                customFields: {
                    hallStatus: 'third_party', fulfillmentRoute: 'R3', thirdPartyState: 'pending',
                    thirdPartyDispatchAt: minAgo(100), thirdPartyNo: 'TP-15',
                },
            }],
            thirdParty,
            feishu,
            cfg: { externalFallbackMinutes: 20, merchantAutoOpenMinutes: 15, autoAssignMinutes: 10, autoRefundMinutes: 30, inProgressSlaMinutes: 45 },
        });
        for (let i = 0; i < 3; i++) await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).toHaveBeenCalledWith(
            expect.anything(), 15, ['third_party'],
            expect.objectContaining({ campusCause: 'external_cancel_failed' }),
        );
        expect(hallSvc.transitionFrom).not.toHaveBeenCalledWith(
            expect.anything(), 15, ['third_party'],
            expect.objectContaining({ hallStatus: 'open' }),
        );
        expect(feishu.pushEvent.mock.calls.some((c: any[]) => c[1] === '外部运单取消失败')).toBe(true);
    });

    // F1 + 回调丢失演练：平台回调完全不达，只靠 5min 对账也必须走完「发现已送达 → 落库 → 不再取消重派」
    it('回调丢失演练：仅靠对账命中 delivered → 落库且不触发取消/回落', async () => {
        const onDeliveryStatus = vi.fn().mockResolvedValue(undefined);
        const cancel = vi.fn().mockResolvedValue({ ok: true });
        const thirdParty = {
            syncStatus: vi.fn().mockResolvedValue({ ok: true, state: 'delivered' }),
            onDeliveryStatus,
            cancel,
        };
        const { svc, hallSvc } = makeEnv({
            openOrders: [{
                id: 501, code: 'TP_SYNC_D',
                customFields: {
                    hallStatus: 'third_party', thirdPartyDeliveryOrderId: 'EXT-1', thirdPartyNo: 'TP-1',
                    thirdPartySyncAt: minAgo(10), thirdPartyDispatchAt: minAgo(9),
                    fulfillmentRoute: 'R2', handoverMode: 'to_campus_rider',
                },
            }],
            cfg: { merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10, externalFallbackMinutes: 20, inProgressSlaMinutes: 45 },
            thirdParty,
        });
        await svc.scan({ channelId: 1 } as any);
        expect(thirdParty.syncStatus).toHaveBeenCalled();
        expect(onDeliveryStatus).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ orderId: 501, thirdPartyNo: 'TP-1', status: 'delivered' }),
        );
        // 已送达绝不能再取消运单或回落重派（旧实现只改内存时会在这里重复配送）
        expect(cancel).not.toHaveBeenCalled();
        expect(hallSvc.transitionFrom).not.toHaveBeenCalledWith(
            expect.anything(), 501, expect.any(Array),
            expect.objectContaining({ hallStatus: 'open' }),
        );
        expect(hallSvc.transitionFrom).not.toHaveBeenCalledWith(
            expect.anything(), 501, expect.any(Array),
            expect.objectContaining({ campusCause: 'external_timeout' }),
        );
    });

    // P3：拍平截断时年轻订单会被 oldest-first 长期饿死，必须让运营在飞书看到积压
    it('单轮扫描达到 200 上限 → 飞书推送调度积压告警（按渠道去重键）', async () => {
        const feishu = { pushEvent: vi.fn() };
        const many = Array.from({ length: 200 }, (_v, i) => ({
            id: 1000 + i,
            code: `BULK${i}`,
            createdAt: dbMinAgo(1),
            customFields: { hallStatus: 'open', hallEnteredAt: minAgo(1) },
        }));
        const { svc } = makeEnv({ scanOrders: many, feishu });
        await svc.scan({ channelId: 1 } as any);
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'dispatch_backlog:1');
        expect(call).toBeDefined();
        expect(call![1]).toBe('调度扫描积压');
        expect(call![2]).toContain('200');
    });

    // P2 积压策略：open 占满窗口时，其它状态必须仍有独立配额，否则路线兜底/异常 SLA 永远不执行
    it('open 积压占满 200 → 在途状态仍独立扫描（商户接单超时兜底不被饿死）', async () => {
        const feishu = { pushEvent: vi.fn() };
        const manyOpen = Array.from({ length: 200 }, (_v, i) => ({
            id: 2000 + i,
            code: `BULK${i}`,
            createdAt: dbMinAgo(1),
            customFields: { hallStatus: 'open', hallEnteredAt: minAgo(1) },
        }));
        const staleMerchant = {
            id: 3001,
            code: 'PM1',
            createdAt: dbMinAgo(30),
            customFields: { hallStatus: 'pending_merchant', hallEnteredAt: minAgo(30), fulfillmentRoute: 'R1' },
        };
        const { svc, hallSvc } = makeEnv({ scanOrders: [...manyOpen, staleMerchant], feishu });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.transitionFrom).toHaveBeenCalledWith(
            expect.anything(),
            3001,
            ['pending_merchant'],
            expect.objectContaining({ hallStatus: 'owned_pool' }),
        );
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'dispatch_backlog:1');
        expect(call![2]).toContain('open(200)');
    });

    it('预约单独立分桶：活单积压时预约单仍能按期放量', async () => {
        const manyOpen = Array.from({ length: 200 }, (_v, i) => ({
            id: 4000 + i,
            code: `BULK${i}`,
            createdAt: dbMinAgo(1),
            customFields: { hallStatus: 'open', hallEnteredAt: minAgo(1) },
        }));
        const sched = {
            id: 4100,
            code: 'SC1',
            createdAt: dbMinAgo(120),
            customFields: { hallStatus: 'scheduled', scheduledFor: new Date(now + 10 * 60_000), hallEnteredAt: minAgo(120) },
        };
        const { svc, hallSvc } = makeEnv({ scanOrders: [...manyOpen, sched] });
        await svc.scan({ channelId: 1 } as any);
        expect(hallSvc.releaseScheduled).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ id: 4100 }),
            expect.anything(),
        );
    });

    it('未达上限 → 不推积压告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const { svc } = makeEnv({
            openOrders: [{ id: 501, code: 'ONE', customFields: { hallStatus: 'open', hallEnteredAt: minAgo(1) } }],
            feishu,
        });
        await svc.scan({ channelId: 1 } as any);
        expect(feishu.pushEvent.mock.calls.some((c: any[]) => c[4] === 'dispatch_backlog:1')).toBe(false);
    });
});

// R7 外部运单异常转工单：同异常只建一张、告警带工单号、工单关闭后不再重复告警
describe('DispatchJobService 外部运单异常转工单（R7）', () => {
    const cfg = {
        merchantAcceptMinutes: 5, merchantAutoOpenMinutes: 15, externalPushTimeoutMinutes: 10,
        externalFallbackMinutes: 20, inProgressSlaMinutes: 45, synchronize: false,
    };

    it('异常态 → 自动建系统工单并在告警中带工单号', async () => {
        const feishu = { pushEvent: vi.fn() };
        const support = { createSystemTicket: vi.fn().mockResolvedValue({ id: 55, created: true }) };
        const { svc } = makeEnv({
            openOrders: [{
                id: 403, code: 'TP_EXC_02',
                customFields: {
                    hallStatus: 'third_party', thirdPartyDispatchAt: minAgo(2),
                    thirdPartyState: 'exception', thirdPartyNo: 'TP-NO', fulfillmentRoute: 'R3',
                },
            }],
            cfg,
            feishu,
            support,
        });
        await svc.scan({ channelId: 1 } as any);
        expect(support.createSystemTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            dedupeKey: 'third_party:TP_EXC_02:TP-NO',
            orderCode: 'TP_EXC_02',
            orderId: 403,
            category: 'delivery',
            source: 'third_party_exception',
        }));
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'TP_EXC_02:external_exception');
        expect(call![2]).toContain('已建工单 #55');
    });

    it('工单关闭已回写 exceptionResolvedAt → 不再建单也不再告警', async () => {
        const feishu = { pushEvent: vi.fn() };
        const support = { createSystemTicket: vi.fn().mockResolvedValue({ id: 55, created: true }) };
        const { svc } = makeEnv({
            openOrders: [{
                id: 404, code: 'TP_EXC_03',
                customFields: {
                    hallStatus: 'third_party', thirdPartyDispatchAt: minAgo(2),
                    thirdPartyState: 'exception', thirdPartyNo: 'TP-03',
                    exceptionResolvedAt: new Date(), fulfillmentRoute: 'R3',
                },
            }],
            cfg,
            feishu,
            support,
        });
        await svc.scan({ channelId: 1 } as any);
        expect(support.createSystemTicket).not.toHaveBeenCalled();
        expect(feishu.pushEvent.mock.calls.some((c: any[]) => c[4] === 'TP_EXC_03:external_exception')).toBe(false);
    });

    it('异常持续未恢复 → 多轮扫描只建一张工单', async () => {
        const feishu = { pushEvent: vi.fn() };
        const support = { createSystemTicket: vi.fn().mockResolvedValue({ id: 55, created: true }) };
        const { svc } = makeEnv({
            openOrders: [{
                id: 405, code: 'TP_EXC_04',
                customFields: {
                    hallStatus: 'third_party', thirdPartyDispatchAt: minAgo(2),
                    thirdPartyState: 'exception', thirdPartyNo: 'TP-04', fulfillmentRoute: 'R3',
                },
            }],
            cfg,
            feishu,
            support,
        });
        await svc.scan({ channelId: 1 } as any);
        await svc.scan({ channelId: 1 } as any);
        expect(support.createSystemTicket).toHaveBeenCalledTimes(1);
    });

    it('外部取消失败连续 3 轮 → 建取消失败工单并告警带工单号', async () => {
        const feishu = { pushEvent: vi.fn() };
        const thirdParty = {
            syncStatus: vi.fn().mockResolvedValue({ ok: true, state: 'pending' }),
            onDeliveryStatus: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue({ ok: false }),
        };
        const support = { createSystemTicket: vi.fn().mockResolvedValue({ id: 66, created: true }) };
        const { svc } = makeEnv({
            scanOrders: [{
                id: 406, code: 'TP_CANCEL_FAIL2', createdAt: dbMinAgo(200),
                customFields: {
                    hallStatus: 'third_party', fulfillmentRoute: 'R3', thirdPartyState: 'pending',
                    thirdPartyDispatchAt: minAgo(100), thirdPartyNo: 'TP-16',
                },
            }],
            thirdParty,
            feishu,
            support,
            cfg: { ...cfg, externalFallbackMinutes: 20, autoAssignMinutes: 10, autoRefundMinutes: 30 },
        });
        for (let i = 0; i < 3; i++) await svc.scan({ channelId: 1 } as any);
        expect(support.createSystemTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            dedupeKey: 'third_party_cancel:TP_CANCEL_FAIL2:TP-16',
            source: 'third_party_exception',
        }));
        const call = feishu.pushEvent.mock.calls.find((c: any[]) => c[4] === 'TP_CANCEL_FAIL2:cancel_failed');
        expect(call![2]).toContain('已建工单 #66');
    });
});

