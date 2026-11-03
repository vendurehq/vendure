import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 验签默认通过；可通过 signState.signOk 控制验签失败用例
const signState = vi.hoisted(() => ({ signOk: true }));
vi.mock('alipay-sdk', () => ({
    AlipaySdk: class {
        checkNotifySign() {
            return signState.signOk;
        }
    },
}));

import { AlipayController } from './alipay.controller';

function makeRes() {
    return { send: vi.fn() } as any;
}

function makeController(options: any = { alipayPublicKey: 'test' }) {
    const orderService = {
        findOneByCode: vi.fn().mockResolvedValue(null),
        settlePayment: vi.fn(),
    };
    const channelService = {
        getDefaultChannel: vi.fn().mockResolvedValue({ id: 1, code: 'default' }),
    };
    const connection = {
        getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) }),
    };
    const ctrl = new AlipayController(
        options as any,
        orderService as any,
        channelService as any,
        connection as any,
    );
    return { ctrl, orderService, connection };
}

const notifyBody = {
    sign: 'x',
    sign_type: 'RSA2',
    app_id: 'app',
    seller_id: '2088000000000000',
    trade_status: 'TRADE_SUCCESS',
    out_trade_no: 'ORD1',
    trade_no: 'TX1',
    total_amount: '10.00',
};

const req = { headers: {} } as any;

describe('支付宝回调：结算失败必须返回 failure（触发重投）且幂等', () => {
    beforeEach(() => vi.clearAllMocks());

    function wireOrder(
        connection: any,
        orderService: any,
        payments: any[],
        settleImpl: () => Promise<any>,
    ) {
        connection.getRepository.mockReturnValue({
            findOne: vi.fn().mockResolvedValue({ code: 'ORD1', channels: [{ id: 1 }] }),
        });
        orderService.findOneByCode.mockResolvedValue({ code: 'ORD1', payments });
        orderService.settlePayment = vi.fn().mockImplementation(settleImpl);
    }

    it('settlePayment 抛错：返回 failure（不是 success）', async () => {
        const { ctrl, orderService, connection } = makeController();
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized', amount: 1000 }], () =>
            Promise.reject(new Error('gateway down')),
        );
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(orderService.settlePayment).toHaveBeenCalledWith(expect.anything(), 7);
        expect(res.send).toHaveBeenCalledWith('fail');
    });

    it('settlePayment 返回 ErrorResult：同样返回 failure', async () => {
        const { ctrl, orderService, connection } = makeController();
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized', amount: 1000 }], () =>
            Promise.resolve({
                __typename: 'SettlePaymentError',
                errorCode: 'SETTLE_PAYMENT_ERROR',
                message: 'settle failed',
            }),
        );
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(res.send).toHaveBeenCalledWith('fail');
    });

    it('首次 failure，平台重投后成功结算返回 success', async () => {
        const { ctrl, orderService, connection } = makeController();
        let attempt = 0;
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized', amount: 1000 }], () => {
            attempt++;
            return attempt === 1
                ? Promise.reject(new Error('transient'))
                : Promise.resolve({ id: 7, state: 'Settled' });
        });
        const first = makeRes();
        await ctrl.notify(req, first, notifyBody);
        expect(first.send).toHaveBeenCalledWith('fail');
        const retry = makeRes();
        await ctrl.notify(req, retry, notifyBody);
        expect(retry.send).toHaveBeenCalledWith('success');
        expect(orderService.settlePayment).toHaveBeenCalledTimes(2);
    });

    it('已结算（Settled）的重复通知：跳过结算并返回 success', async () => {
        const { ctrl, orderService, connection } = makeController();
        wireOrder(connection, orderService, [{ id: 7, state: 'Settled' }], () =>
            Promise.resolve({ id: 7, state: 'Settled' }),
        );
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.send).toHaveBeenCalledWith('success');
    });

    it('订单查不到：返回 failure 并告警（已扣款却无单）', async () => {
        const { ctrl, orderService, connection } = makeController();
        connection.getRepository.mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) });
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.send).toHaveBeenCalledWith('fail');
    });

    it('app_id 与配置不符：拒绝结算并返回 failure', async () => {
        const { ctrl, orderService, connection } = makeController({
            alipayPublicKey: 'test',
            auth: { appId: 'expected-app' },
        });
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized', amount: 1000 }], () =>
            Promise.resolve({ id: 7, state: 'Settled' }),
        );
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.send).toHaveBeenCalledWith('fail');
    });

    it('seller_id 与配置不符：拒绝结算并返回 failure', async () => {
        const { ctrl, orderService, connection } = makeController({
            alipayPublicKey: 'test',
            sellerId: '2088999999999999',
        });
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized', amount: 1000 }], () =>
            Promise.resolve({ id: 7, state: 'Settled' }),
        );
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.send).toHaveBeenCalledWith('fail');
    });

    it('total_amount 与订单待结算金额不符：拒绝结算并返回 failure', async () => {
        const { ctrl, orderService, connection } = makeController();
        wireOrder(connection, orderService, [{ id: 7, state: 'Authorized', amount: 1000 }], () =>
            Promise.resolve({ id: 7, state: 'Settled' }),
        );
        const res = makeRes();
        await ctrl.notify(req, res, { ...notifyBody, total_amount: '9.99' });
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.send).toHaveBeenCalledWith('fail');
    });

    it('验签失败：不查订单、不结算并返回 failure', async () => {
        signState.signOk = false;
        const { ctrl, orderService } = makeController();
        const res = makeRes();
        await ctrl.notify(req, res, notifyBody);
        expect(orderService.findOneByCode).not.toHaveBeenCalled();
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.send).toHaveBeenCalledWith('fail');
        signState.signOk = true;
    });
});
