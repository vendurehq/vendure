// 退款能力闸门 + 立即结算：6 个调度退款调用点统一走 refundPayment，此处覆盖它的判定与终态回读
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, PaymentMethod } from '@vendure/core';

import { PaymentScheduleService } from './payment-schedule.service';

function makeEnv(handlerCode: string | null) {
    const refundRepo = {
        findOne: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
    };
    const pmRepo = {
        find: vi.fn().mockResolvedValue(handlerCode ? [{ id: 1, code: 'pm', handler: { code: handlerCode } }] : []),
    };
    const connection = {
        getRepository: vi.fn((_ctx: any, entity: any) => (entity === PaymentMethod ? pmRepo : refundRepo)),
        rawConnection: { getRepository: vi.fn() },
    } as any;
    const orderService = { settleRefund: vi.fn() };
    const paymentService = { createRefund: vi.fn() };
    const svc = new PaymentScheduleService(connection, {} as any, orderService as any, paymentService as any);
    const ctx = { channelId: 1 } as any;
    const order = { id: 100, code: 'T100' } as any;
    const payment = { id: 11, method: 'pm', amount: 500, state: 'Settled', refunds: [] } as any;
    return { svc, ctx, order, payment, orderService, paymentService, refundRepo };
}

function refund(svc: PaymentScheduleService, ctx: any, order: any, payment: any, amount = 300) {
    return (svc as any).refundPayment(ctx, order, payment, amount, 'test reason') as Promise<boolean>;
}

describe('PaymentScheduleService 退款闸门', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('货到付款（cash-on-delivery）：不建待退款单，改落人工现金退还任务', async () => {
        const env = makeEnv('cash-on-delivery');
        const warn = vi.spyOn(Logger, 'warn').mockImplementation((() => undefined) as any);
        await expect(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(false);
        expect(env.paymentService.createRefund).not.toHaveBeenCalled();
        expect(env.orderService.settleRefund).not.toHaveBeenCalled();
        expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('人工现金退还');
    });

    it('有退款能力：createRefund 后立即 settleRefund，回读 Settled 才返回 true', async () => {
        const env = makeEnv('wechatpay');
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.refundRepo.findOne.mockResolvedValue({ id: 77, state: 'Settled', paymentId: 11 });
        await expect(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(true);
        expect(env.orderService.settleRefund).toHaveBeenCalledWith(env.ctx, { id: 77, transactionId: 11 });
        expect(env.refundRepo.update).not.toHaveBeenCalled();
    });

    it('结算抛错：退款单置 Failed 并返回 false（不静默当作已退）', async () => {
        const env = makeEnv('wechatpay');
        vi.spyOn(Logger, 'error').mockImplementation((() => undefined) as any);
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.orderService.settleRefund.mockRejectedValue(new Error('gateway down'));
        await expect(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(false);
        expect(env.refundRepo.update).toHaveBeenCalledWith(77, { state: 'Failed' });
    });

    it('结算未抛出但回读仍非 Settled：同样置 Failed 并返回 false', async () => {
        const env = makeEnv('wechatpay');
        vi.spyOn(Logger, 'error').mockImplementation((() => undefined) as any);
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.refundRepo.findOne.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        await expect(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(false);
        expect(env.refundRepo.update).toHaveBeenCalledWith(77, { state: 'Failed' });
    });

    it('查不到支付方式时按可退处理，保持原行为', async () => {
        const env = makeEnv(null);
        vi.spyOn(Logger, 'warn').mockImplementation((() => undefined) as any);
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.refundRepo.findOne.mockResolvedValue({ id: 77, state: 'Settled', paymentId: 11 });
        await expect(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(true);
        expect(env.paymentService.createRefund).toHaveBeenCalledOnce();
    });
});
