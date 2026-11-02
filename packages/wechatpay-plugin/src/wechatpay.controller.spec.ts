import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 叶子模块 mock：本题只验证 dev 端点门禁，不需真实渠道解析 / 渠道支付配置
vi.mock('@vendure/cjk-plugin/lib/src/tenant/domain-resolver.service', () => ({
    findChannelByDomain: vi.fn().mockResolvedValue({ id: 1, code: 'default' }),
}));
vi.mock('@vendure/cjk-plugin/lib/src/payment/payment-config', () => ({
    getPaymentOverride: vi.fn().mockReturnValue(null),
}));

import { WechatpayController } from './wechatpay.controller';

function makeRes() {
    const res: any = {
        status: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
}

function makeController(devBypass: boolean) {
    const settlement = { find: vi.fn().mockReturnValue(undefined), settle: vi.fn() };
    const orderService = { findOneByCode: vi.fn().mockResolvedValue(null), settlePayment: vi.fn() };
    // 结算前会先全局按 code 取单（可能跨渠道），mock 为查不到单
    const connection = {
        getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }),
    };
    const ctrl = new WechatpayController(
        { devBypass } as any,
        orderService as any,
        { getDefaultChannel: vi.fn() } as any,
        connection as any,
        {} as any,
        {} as any,
        settlement as any,
    );
    return { ctrl, settlement, orderService, connection };
}

const req = { query: { outTradeNo: 'ORD1' }, headers: {}, hostname: 'localhost' } as any;

describe('WechatpayController dev 端点门禁（P0 修复：仅 devBypass 可用）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('devBypass 关闭：dev-notify 返回 404，且不触发任何结算', async () => {
        const { ctrl, settlement, orderService } = makeController(false);
        const res = makeRes();
        await ctrl.devNotify(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(settlement.find).not.toHaveBeenCalled();
        expect(settlement.settle).not.toHaveBeenCalled();
        expect(orderService.findOneByCode).not.toHaveBeenCalled();
    });

    it('devBypass 关闭：dev-pay 返回 404 页面', () => {
        const { ctrl } = makeController(false);
        const res = makeRes();
        ctrl.getDevPayPage(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.send).toHaveBeenCalledWith('Not Found');
    });

    it('devBypass 开启：dev-notify 正常路由结算并返回 200', async () => {
        const { ctrl, settlement } = makeController(true);
        // 注册结算器命中（非订单路由），结算成功即 200
        const settle = vi.fn().mockResolvedValue(undefined);
        settlement.find.mockReturnValue({ prefix: 'ORD', settle });
        const res = makeRes();
        await ctrl.devNotify(req, res);
        expect(settlement.find).toHaveBeenCalledWith('ORD1');
        expect(settle).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('回调渠道与订单渠道不同时：切到订单所属渠道结算', async () => {
        const { ctrl, orderService, connection } = makeController(true);
        // 回调域名解析到渠道 1（默认渠道），订单实际属于渠道 9（t1）
        connection.getRepository.mockReturnValue({
            findOne: vi.fn().mockResolvedValue({ code: 'ORD1', channels: [{ id: 9, code: 't1' }] }),
        });
        const res = makeRes();
        await ctrl.devNotify(req, res);
        const ctx = orderService.findOneByCode.mock.calls[0][0];
        expect(ctx.channelId).toBe(9);
        expect(ctx.channel.code).toBe('t1');
    });

    it('devBypass 开启：dev-pay 渲染模拟支付页', () => {
        const { ctrl } = makeController(true);
        const res = makeRes();
        ctrl.getDevPayPage(req, res);
        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(res.send).toHaveBeenCalledTimes(1);
        expect(String(res.send.mock.calls[0][0])).toContain('ORD1');
    });
});

describe('结算失败语义与幂等（回调不能吞异常）', () => {
    beforeEach(() => vi.clearAllMocks());

    const orderWithPayments = (payments: any[]) => ({
        code: 'ORD1',
        channels: [{ id: 1, code: 'default' }],
        payments,
    });

    /** 让全局取单命中 ORD1，并返回给定 payments */
    function wireOrder(
        connection: any,
        orderService: any,
        payments: any[],
        settleImpl: () => Promise<any>,
    ) {
        connection.getRepository.mockReturnValue({
            findOne: vi.fn().mockResolvedValue({ code: 'ORD1', channels: [{ id: 1 }] }),
        });
        orderService.findOneByCode.mockResolvedValue(orderWithPayments(payments));
        orderService.settlePayment = vi.fn().mockImplementation(settleImpl);
    }

    it('settlePayment 抛错：返回 500 FAIL，让微信重投', async () => {
        const { ctrl, orderService, connection } = makeController(true);
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized' }], () =>
            Promise.reject(new Error('gateway down')),
        );
        const res = makeRes();
        await ctrl.devNotify(req, res);
        expect(orderService.settlePayment).toHaveBeenCalledWith(expect.anything(), 7);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FAIL' }));
    });

    it('settlePayment 返回 ErrorResult：同样返回 500 FAIL', async () => {
        const { ctrl, orderService, connection } = makeController(true);
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized' }], () =>
            Promise.resolve({
                __typename: 'SettlePaymentError',
                errorCode: 'SETTLE_PAYMENT_ERROR',
                message: 'settle failed',
            }),
        );
        const res = makeRes();
        await ctrl.devNotify(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('首次失败返回 FAIL，平台重投后可成功结算（返回 200 SUCCESS）', async () => {
        const { ctrl, orderService, connection } = makeController(true);
        let attempt = 0;
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized' }], () => {
            attempt++;
            return attempt === 1
                ? Promise.reject(new Error('transient'))
                : Promise.resolve({ id: 7, state: 'Settled' });
        });
        const first = makeRes();
        await ctrl.devNotify(req, first);
        expect(first.status).toHaveBeenCalledWith(500);
        const retry = makeRes();
        await ctrl.devNotify(req, retry);
        expect(retry.status).toHaveBeenCalledWith(200);
        expect(retry.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUCCESS' }));
        expect(orderService.settlePayment).toHaveBeenCalledTimes(2);
    });

    it('已结算（Settled）的重复通知：安全跳过，返回 200 SUCCESS 且不再结算', async () => {
        const { ctrl, orderService, connection } = makeController(true);
        wireOrder(connection, orderService, [{ id: 7, state: 'Settled' }], () =>
            Promise.resolve({ id: 7, state: 'Settled' }),
        );
        const res = makeRes();
        await ctrl.devNotify(req, res);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('订单查不到：返回 500 FAIL（已扣款却无单必须告警并重投）', async () => {
        const { ctrl, orderService, connection } = makeController(true);
        connection.getRepository.mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) });
        const res = makeRes();
        await ctrl.devNotify(req, res);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});
