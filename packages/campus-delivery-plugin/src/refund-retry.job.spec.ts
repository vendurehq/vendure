import { describe, expect, it, vi } from 'vitest';
import { ModuleRef } from '@nestjs/core';
import { Injector, Payment } from '@vendure/core';
import { REFUND_RETRY_MAX_ATTEMPTS, RefundRetryJob } from './refund-retry.job';

interface SetupOptions {
    scanRows?: any[];
    orderRow?: any;
    payments?: any[];
    refundedSum?: number;
    pendingRows?: any[];
    lockOk?: boolean;
    updateRows?: any[];
    paidSum?: number;
    refundOrderImpl?: (ctx: any, input: any) => Promise<any>;
    installedAt?: { at: string } | null;
    exhaustedAlready?: boolean;
}

function setup(opts: SetupOptions = {}) {
    const state = {
        orderRow: opts.orderRow ?? {
            id: 467,
            code: 'V467',
            state: 'Processing',
            hallStatus: 'refund_failed',
            deliveryStatus: null,
        },
        payments: opts.payments ?? [{ id: 1, amount: 1632, state: 'Authorized' }],
    };
    const calls: any[] = [];
    const rawQuery = vi.fn(async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        if (sql.includes('customFieldsHallstatus') && sql.includes('LIMIT')) return opts.scanRows ?? [state.orderRow];
        if (sql.includes('FROM "order" WHERE id = $1')) return [state.orderRow];
        if (sql.includes('FROM refund r') && sql.includes("state = 'Pending'")) return opts.pendingRows ?? [];
        if (sql.includes('SUM(amount)')) return [{ paid: opts.paidSum ?? 1632 }];
        if (sql.includes('UPDATE "order"')) return opts.updateRows ?? [{ id: state.orderRow.id }];
        if (sql.includes('UPDATE refund')) return [];
        if (sql.includes('order_channels_channel')) return [{ channelId: 113 }];
        return [];
    });
    const runner = {
        connect: vi.fn(async () => undefined),
        release: vi.fn(async () => undefined),
        query: vi.fn(async (sql: string) => (sql.includes('pg_try_advisory_lock') ? [{ ok: opts.lockOk ?? true }] : [{}])),
    };
    const refundQb = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn(async () => ({ sum: opts.refundedSum ?? 0 })),
    };
    const connection: any = {
        rawConnection: {
            query: rawQuery,
            createQueryRunner: vi.fn(() => runner),
            getRepository: vi.fn((entity: any) => {
                if (entity === Payment) return { find: vi.fn(async () => state.payments) };
                return {
                    createQueryBuilder: vi.fn(() => refundQb),
                    findOne: vi.fn(async () => ({ id: 11, paymentId: 1 })),
                    update: vi.fn(async () => undefined),
                };
            }),
        },
    };

    let incrCount = 0;
    let exhausted = !!opts.exhaustedAlready;
    const dedupe: any = {
        seen: vi.fn(async () => false),
        mark: vi.fn(async () => undefined),
        incr: vi.fn(async () => {
            incrCount += 1;
            return incrCount;
        }),
        seenOrMark: vi.fn(async () => {
            const wasMarked = exhausted;
            exhausted = true;
            return wasMarked;
        }),
        setJson: vi.fn(async () => undefined),
        getJson: vi.fn(async (key: string) => {
            if (key.startsWith('campus:refund_retry:installed_at')) return opts.installedAt ?? null;
            return null;
        }),
        del: vi.fn(async () => undefined),
    };
    const feishu: any = { pushEvent: vi.fn(async () => undefined) };
    const support: any = { createSystemTicket: vi.fn(async () => ({ id: 101 })) };
    const requestContextService: any = { create: vi.fn(async () => ({ apiType: 'admin', channelId: 113 })) };
    const orderSvc: any = {
        refundOrder: vi.fn(opts.refundOrderImpl ?? (async () => ({ id: 11 }))),
        settleRefund: vi.fn(async () => undefined),
        cancelOrder: vi.fn(async () => ({})),
    };

    const job = new RefundRetryJob(connection, dedupe, feishu, support, requestContextService, { get: vi.fn() } as any);
    job.orderSvcOverride = orderSvc;
    job.cutoffOverride = new Date('2026-11-08T00:00:00Z');
    return { job, orderSvc, dedupe, feishu, support, connection, rawQuery, runner, state };
}

describe('RefundRetryJob (A9)', () => {
    it('构造器不直接依赖 Injector（插件模块不提供该 provider，须用 ModuleRef 构造）', () => {
        const types = Reflect.getMetadata('design:paramtypes', RefundRetryJob) as any[];
        expect(types).toBeDefined();
        expect(types.includes(Injector)).toBe(false);
        expect(types.includes(ModuleRef)).toBe(true);
    });

    it('重试成功：按余额退款、结算、取消并落终态，并清理重试状态', async () => {
        const { job, orderSvc, dedupe, rawQuery } = setup();
        const res = await job.runOnce();

        expect(res.done).toBe(1);
        expect(orderSvc.refundOrder).toHaveBeenCalledTimes(1);
        const input = orderSvc.refundOrder.mock.calls[0][1];
        expect(input.amount).toBe(1632);
        expect(input.shipping).toBe(0);
        expect(input.adjustment).toBe(0);
        expect(orderSvc.settleRefund).toHaveBeenCalledTimes(1);
        expect(orderSvc.cancelOrder).toHaveBeenCalledTimes(1);
        // 落终态（条件更新限定 refund_failed）
        const update = rawQuery.mock.calls.find(c => String(c[0]).includes('UPDATE "order"'));
        expect(String(update?.[0])).toContain("customFieldsHallstatus\" = 'no_rider_final'");
        expect(String(update?.[0])).toContain("\"customFieldsHallstatus\" = 'refund_failed'");
        // 成功后四个状态键都清理
        expect(dedupe.del).toHaveBeenCalledTimes(4);
    });

    it('幂等不重复退：余额已为 0 时不再退款，只补取消并落终态', async () => {
        const { job, orderSvc } = setup({ refundedSum: 1632 });
        const res = await job.runOnce();

        expect(res.done).toBe(1);
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
        expect(orderSvc.cancelOrder).toHaveBeenCalledTimes(1);
    });

    it('锁被其他退款路径占用：本轮跳过且不消耗尝试次数', async () => {
        const { job, orderSvc, dedupe } = setup({ lockOk: false });
        const res = await job.runOnce();

        expect(res.skipped).toBe(1);
        expect(orderSvc.refundOrder).not.toHaveBeenCalled();
        expect(dedupe.incr).not.toHaveBeenCalled();
    });

    it('重试耗尽：4 次后退避停止，升级飞书告警 + 系统工单，且只升级一次', async () => {
        const { job, orderSvc, dedupe, feishu, support } = setup({
            refundOrderImpl: async () => {
                throw new Error('gateway timeout');
            },
        });

        for (let i = 0; i < REFUND_RETRY_MAX_ATTEMPTS; i += 1) {
            const res = await job.runOnce();
            if (i < REFUND_RETRY_MAX_ATTEMPTS - 1) {
                expect(res.retried).toBe(1);
            } else {
                expect(res.escalated).toBe(1);
            }
        }

        expect(orderSvc.refundOrder).toHaveBeenCalledTimes(REFUND_RETRY_MAX_ATTEMPTS);
        // 前 3 次失败各写一次退避窗口
        expect(dedupe.mark).toHaveBeenCalledTimes(REFUND_RETRY_MAX_ATTEMPTS - 1);
        expect(support.createSystemTicket).toHaveBeenCalledTimes(1);
        expect(feishu.pushEvent).toHaveBeenCalledTimes(1);
        const ticketInput = support.createSystemTicket.mock.calls[0][1];
        expect(ticketInput.category).toBe('refund');
        expect(ticketInput.source).toBe('refund_retry_exhausted');
        expect(ticketInput.orderCode).toBe('V467');

        // 第 5 轮：已升级过（seenOrMark=true），不重复建单/告警
        const again = await job.runOnce();
        expect(again.escalated).toBe(1);
        expect(support.createSystemTicket).toHaveBeenCalledTimes(1);
        expect(feishu.pushEvent).toHaveBeenCalledTimes(1);
    });

    it('失败原因会持久化，供耗尽告警展示', async () => {
        const { job, dedupe } = setup({
            refundOrderImpl: async () => {
                throw new Error('channel closed');
            },
        });
        await job.runOnce();
        expect(dedupe.setJson).toHaveBeenCalled();
        const errCall = dedupe.setJson.mock.calls.find((c: any[]) => String(c[0]).includes('error:467'));
        expect(errCall?.[1]).toMatchObject({ message: 'channel closed' });
    });
});
