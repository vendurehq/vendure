"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// 退款能力闸门 + 立即结算：6 个调度退款调用点统一走 refundPayment，此处覆盖它的判定与终态回读
const vitest_1 = require("vitest");
const core_1 = require("@vendure/core");
const payment_schedule_service_1 = require("./payment-schedule.service");
function makeEnv(handlerCode) {
    const refundRepo = {
        findOne: vitest_1.vi.fn(),
        update: vitest_1.vi.fn().mockResolvedValue(undefined),
    };
    const pmRepo = {
        find: vitest_1.vi.fn().mockResolvedValue(handlerCode ? [{ id: 1, code: 'pm', handler: { code: handlerCode } }] : []),
    };
    const connection = {
        getRepository: vitest_1.vi.fn((_ctx, entity) => (entity === core_1.PaymentMethod ? pmRepo : refundRepo)),
        rawConnection: { getRepository: vitest_1.vi.fn() },
    };
    const orderService = { settleRefund: vitest_1.vi.fn() };
    const paymentService = { createRefund: vitest_1.vi.fn() };
    const svc = new payment_schedule_service_1.PaymentScheduleService(connection, {}, orderService, paymentService);
    const ctx = { channelId: 1 };
    const order = { id: 100, code: 'T100' };
    const payment = { id: 11, method: 'pm', amount: 500, state: 'Settled', refunds: [] };
    return { svc, ctx, order, payment, orderService, paymentService, refundRepo };
}
function refund(svc, ctx, order, payment, amount = 300) {
    return svc.refundPayment(ctx, order, payment, amount, 'test reason');
}
(0, vitest_1.describe)('PaymentScheduleService 退款闸门', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)('货到付款（cash-on-delivery）：不建待退款单，改落人工现金退还任务', async () => {
        const env = makeEnv('cash-on-delivery');
        const warn = vitest_1.vi.spyOn(core_1.Logger, 'warn').mockImplementation((() => undefined));
        await (0, vitest_1.expect)(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(false);
        (0, vitest_1.expect)(env.paymentService.createRefund).not.toHaveBeenCalled();
        (0, vitest_1.expect)(env.orderService.settleRefund).not.toHaveBeenCalled();
        (0, vitest_1.expect)(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain('人工现金退还');
    });
    (0, vitest_1.it)('有退款能力：createRefund 后立即 settleRefund，回读 Settled 才返回 true', async () => {
        const env = makeEnv('wechatpay');
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.refundRepo.findOne.mockResolvedValue({ id: 77, state: 'Settled', paymentId: 11 });
        await (0, vitest_1.expect)(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(true);
        (0, vitest_1.expect)(env.orderService.settleRefund).toHaveBeenCalledWith(env.ctx, { id: 77, transactionId: 11 });
        (0, vitest_1.expect)(env.refundRepo.update).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('结算抛错：退款单置 Failed 并返回 false（不静默当作已退）', async () => {
        const env = makeEnv('wechatpay');
        vitest_1.vi.spyOn(core_1.Logger, 'error').mockImplementation((() => undefined));
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.orderService.settleRefund.mockRejectedValue(new Error('gateway down'));
        await (0, vitest_1.expect)(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(false);
        (0, vitest_1.expect)(env.refundRepo.update).toHaveBeenCalledWith(77, { state: 'Failed' });
    });
    (0, vitest_1.it)('结算未抛出但回读仍非 Settled：同样置 Failed 并返回 false', async () => {
        const env = makeEnv('wechatpay');
        vitest_1.vi.spyOn(core_1.Logger, 'error').mockImplementation((() => undefined));
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.refundRepo.findOne.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        await (0, vitest_1.expect)(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(false);
        (0, vitest_1.expect)(env.refundRepo.update).toHaveBeenCalledWith(77, { state: 'Failed' });
    });
    (0, vitest_1.it)('查不到支付方式时按可退处理，保持原行为', async () => {
        const env = makeEnv(null);
        vitest_1.vi.spyOn(core_1.Logger, 'warn').mockImplementation((() => undefined));
        env.paymentService.createRefund.mockResolvedValue({ id: 77, state: 'Pending', paymentId: 11 });
        env.refundRepo.findOne.mockResolvedValue({ id: 77, state: 'Settled', paymentId: 11 });
        await (0, vitest_1.expect)(refund(env.svc, env.ctx, env.order, env.payment)).resolves.toBe(true);
        (0, vitest_1.expect)(env.paymentService.createRefund).toHaveBeenCalledOnce();
    });
});
