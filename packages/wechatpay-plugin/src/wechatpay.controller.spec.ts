import 'reflect-metadata';
import * as crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 渠道覆盖凭证：按 channel.customFields.payConfig.wechatpayJson 还原真实解析语义
vi.mock('@vendure/cjk-plugin/lib/src/payment/payment-config', () => ({
    getPaymentOverride: vi.fn((ctx: any, key: string) => {
        if (key !== 'wechatpay') return null;
        const raw = ctx?.channel?.customFields?.payConfig?.wechatpayJson;
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }),
}));

// WxPay 打桩：APIv3 key 决定验签/解密是否成功（模拟真实 GCM 认证语义）
const wxState = vi.hoisted(() => ({
    apiKey: 'key-t1',
    forceSdkFail: false,
    decrypted: {
        out_trade_no: 'ORD1',
        transaction_id: 'TX1',
        appid: 'appid-t1',
        mchid: 'mch-1',
        trade_state: 'SUCCESS',
        amount: { total: 1000, currency: 'CNY' },
    } as any,
}));
vi.mock('wechatpay-node-v3', () => ({
    default: class {
        private cfg: any;
        constructor(cfg: any) {
            this.cfg = cfg;
        }
        async verifySign() {
            return !wxState.forceSdkFail && this.cfg.key === wxState.apiKey;
        }
        decipher_gcm() {
            if (this.cfg.key !== wxState.apiKey) {
                throw new Error('unable to authenticate data');
            }
            return wxState.decrypted;
        }
    },
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

const argsOf = (o: Record<string, string>) =>
    Object.entries(o).map(([name, value]) => ({ name, value }));

/**
 * 通用控制器装配：
 * - channels: 渠道级覆盖凭证（channel.customFields.payConfig）
 * - methods: PaymentMethod 及其绑定渠道
 * - order: 全局按 code 反查到的订单（含 channels）
 */
function makeController(opts: {
    devBypass?: boolean;
    channels?: any[];
    methods?: any[];
    order?: any;
    payments?: any[];
    paymentRow?: any;
    settleImpl?: (...args: any[]) => Promise<any>;
    registry?: any;
} = {}) {
    const {
        devBypass = true,
        channels = [],
        methods = [],
        order = null,
        payments = [],
        paymentRow = null,
    } = opts;

    const settlement = opts.registry ?? { find: vi.fn().mockReturnValue(undefined) };
    const orderService = {
        findOneByCode: vi.fn().mockImplementation(async () =>
            order ? { ...order, payments } : null,
        ),
        settlePayment: vi
            .fn()
            .mockImplementation(opts.settleImpl ?? (async (ctx: any, id: any) => ({ id, state: 'Settled' }))),
    };

    const connection = {
        getRepository: vi.fn((_ctx: any, entity: any) => {
            const name = entity?.name;
            if (name === 'Channel') {
                return { find: vi.fn().mockResolvedValue(channels) };
            }
            if (name === 'PaymentMethod') {
                return { find: vi.fn().mockResolvedValue(methods) };
            }
            if (name === 'Order') {
                return { findOne: vi.fn().mockResolvedValue(order) };
            }
            if (name === 'Payment') {
                return { findOne: vi.fn().mockResolvedValue(paymentRow) };
            }
            return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
        }),
    };

    const channelService = {
        getDefaultChannel: vi.fn().mockResolvedValue({ id: 1, code: 'default' }),
        findOne: vi.fn().mockImplementation(async (_ctx: any, id: any) => ({
            id,
            code: `ch-${id}`,
        })),
    };

    const requestContextService = {
        create: vi.fn().mockResolvedValue({
            apiType: 'admin',
            channel: { id: 1, code: 'default' },
            channelId: 1,
            isAuthorized: true,
        }),
    };

    const ctrl = new WechatpayController(
        { devBypass } as any,
        orderService as any,
        channelService as any,
        connection as any,
        requestContextService as any,
        settlement as any,
    );
    return { ctrl, settlement, orderService, connection, channelService, requestContextService };
}

const devReq = { query: { outTradeNo: 'ORD1' }, headers: {}, hostname: 'localhost' } as any;

const notifyHeaders = {
    'wechatpay-timestamp': 't',
    'wechatpay-nonce': 'n',
    'wechatpay-signature': 'sig',
    'wechatpay-serial': 'platform-serial',
};

const notifyBody = {
    id: 'evt',
    event_type: 'TRANSACTION.SUCCESS',
    resource: { ciphertext: 'c', associated_data: 'ad', nonce: 'n' },
};

describe('WechatpayController dev 端点门禁（仅 devBypass 可用）', () => {
    beforeEach(() => vi.clearAllMocks());

    it('devBypass 关闭：dev-notify 返回 404，且不触发任何结算', async () => {
        const { ctrl, settlement, orderService } = makeController({ devBypass: false });
        const res = makeRes();
        await ctrl.devNotify(devReq, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(settlement.find).not.toHaveBeenCalled();
        expect(orderService.findOneByCode).not.toHaveBeenCalled();
    });

    it('devBypass 关闭：dev-pay 返回 404 页面', () => {
        const { ctrl } = makeController({ devBypass: false });
        const res = makeRes();
        ctrl.getDevPayPage(devReq, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.send).toHaveBeenCalledWith('Not Found');
    });

    it('devBypass 开启：走注册器结算并返回 200', async () => {
        const settle = vi.fn().mockResolvedValue(undefined);
        const registry = { find: vi.fn().mockReturnValue({ prefix: 'ORD', settle }) };
        const { ctrl } = makeController({ registry, order: { code: 'ORD1', channels: [{ id: 1 }] } });
        const res = makeRes();
        await ctrl.devNotify(devReq, res);
        expect(settle).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('dev 端点按订单反查渠道：切到订单所属渠道结算', async () => {
        const { ctrl, orderService } = makeController({
            order: { code: 'ORD1', channels: [{ id: 9, code: 't1' }] },
            payments: [{ id: 7, state: 'Authorized', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.devNotify(devReq, res);
        const ctx = orderService.findOneByCode.mock.calls[0][0];
        expect(ctx.channelId).toBe(9);
        expect(ctx.channel.code).toBe('t1');
    });

    it('devBypass 开启：dev-pay 渲染模拟支付页', () => {
        const { ctrl } = makeController();
        const res = makeRes();
        ctrl.getDevPayPage(devReq, res);
        expect(res.status).not.toHaveBeenCalledWith(404);
        expect(String(res.send.mock.calls[0][0])).toContain('ORD1');
    });
});

describe('正式回调 notify：按 out_trade_no 反查渠道（不依赖 Host）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        wxState.apiKey = 'key-t1';
        wxState.forceSdkFail = false;
        wxState.decrypted = {
            out_trade_no: 'ORD1',
            transaction_id: 'TX1',
            appid: 'appid-t1',
            mchid: 'mch-1',
            trade_state: 'SUCCESS',
            amount: { total: 1000, currency: 'CNY' },
        };
    });

    /** t1 渠道凭证（渠道级覆盖）+ 订单在渠道 7 */
    const baseChannels = [
        {
            id: 7,
            code: 't1',
            customFields: {
                payConfig: {
                    wechatpayJson: JSON.stringify({
                        appId: 'appid-t1',
                        mchId: 'mch-1',
                        apiKey: 'key-t1',
                        publicKey: 'pk',
                        privateKey: 'priv',
                        serialNo: 'serial',
                    }),
                },
            },
        },
    ];
    const orderInCh7 = { code: 'ORD1', channels: [{ id: 7, code: 't1' }] };

    it('验签/解密凭证全部不匹配：返回 401 FAIL，不结算', async () => {
        wxState.apiKey = 'other-key';
        const { ctrl, orderService } = makeController({
            channels: baseChannels,
            order: orderInCh7,
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FAIL' }));
        expect(orderService.settlePayment).not.toHaveBeenCalled();
    });

    it('t1 单渠道：解密成功、订单渠道一致 → 结算并 200', async () => {
        const { ctrl, orderService } = makeController({
            channels: baseChannels,
            order: orderInCh7,
            payments: [{ id: 7, state: 'Authorized', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        const ctx = orderService.findOneByCode.mock.calls[0][0];
        expect(ctx.channelId).toBe(7);
        expect(orderService.settlePayment).toHaveBeenCalledWith(expect.anything(), 7);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUCCESS' }));
    });

    it('t2 双渠道：同一回调经凭证试解 + 订单渠道裁决命中 t2（channel 8）', async () => {
        // 两个渠道共用同一商户号/密钥（真实多店常见），但只在 t2 有该订单
        const channels = [
            ...baseChannels,
            {
                id: 8,
                code: 't2',
                customFields: {
                    payConfig: {
                        wechatpayJson: JSON.stringify({
                            appId: 'appid-t1',
                            mchId: 'mch-1',
                            apiKey: 'key-t1',
                            publicKey: 'pk',
                            privateKey: 'priv',
                            serialNo: 'serial',
                        }),
                    },
                },
            },
        ];
        const { ctrl, orderService } = makeController({
            channels,
            order: { code: 'ORD1', channels: [{ id: 8, code: 't2' }] },
            payments: [{ id: 11, state: 'Authorized', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        const ctx = orderService.findOneByCode.mock.calls[0][0];
        expect(ctx.channelId).toBe(8);
        expect(ctx.channel.code).toBe('t2');
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('微信支付公钥模式：SDK 平台证书不可用时，用渠道公钥 RSA 验签仍可结算', async () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const channels = [
            {
                id: 7,
                code: 't1',
                customFields: {
                    payConfig: {
                        wechatpayJson: JSON.stringify({
                            appId: 'appid-t1',
                            mchId: 'mch-1',
                            apiKey: 'key-t1',
                            publicKey: pubPem,
                            privateKey: 'priv',
                            serialNo: 'serial',
                        }),
                    },
                },
            },
        ];
        const body = {
            id: 'evt-rsa',
            event_type: 'TRANSACTION.SUCCESS',
            resource: { ciphertext: 'c', associated_data: 'ad', nonce: 'n' },
        };
        const bodyStr = JSON.stringify(body);
        const timestamp = '1700000000';
        const nonce = 'rsa-nonce';
        const signature = crypto
            .createSign('RSA-SHA256')
            .update(`${timestamp}\n${nonce}\n${bodyStr}\n`)
            .sign(privateKey, 'base64');
        // 强制 SDK 平台证书路径失败，只有「公钥直验」能通过
        wxState.forceSdkFail = true;

        const { ctrl, orderService } = makeController({
            channels,
            order: { code: 'ORD1', channels: [{ id: 7, code: 't1' }] },
            payments: [{ id: 7, state: 'Authorized', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.notify(
            {
                headers: {
                    'wechatpay-timestamp': timestamp,
                    'wechatpay-nonce': nonce,
                    'wechatpay-signature': signature,
                    'wechatpay-serial': 'PUB_KEY_ID_PROBE',
                },
                rawBody: Buffer.from(bodyStr, 'utf8'),
            } as any,
            res,
            body,
        );
        expect(orderService.settlePayment).toHaveBeenCalledWith(expect.anything(), 7);
        expect(res.status).toHaveBeenCalledWith(200);
        wxState.forceSdkFail = false;
    });

    it('凭证渠道与订单渠道无交集：返回 500 CHANNEL_MISMATCH，不结算', async () => {
        const { ctrl, orderService } = makeController({
            channels: baseChannels, // 只有渠道 7 的凭证
            order: { code: 'ORD1', channels: [{ id: 9, code: 't3' }] },
            payments: [{ id: 7, state: 'Authorized', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'FAIL', message: 'CHANNEL_MISMATCH' }),
        );
        expect(orderService.settlePayment).not.toHaveBeenCalled();
    });

    it('订单不存在：返回 500 ORDER_NOT_FOUND（不静默 200）', async () => {
        const { ctrl, orderService } = makeController({ channels: baseChannels, order: null });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'FAIL', message: 'ORDER_NOT_FOUND' }),
        );
        expect(orderService.settlePayment).not.toHaveBeenCalled();
    });

    it('金额不一致：返回 500 AMOUNT_MISMATCH，不结算', async () => {
        wxState.decrypted.amount = { total: 999, currency: 'CNY' };
        const { ctrl, orderService } = makeController({
            channels: baseChannels,
            order: orderInCh7,
            payments: [{ id: 7, state: 'Authorized', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'FAIL', message: 'AMOUNT_MISMATCH' }),
        );
        expect(orderService.settlePayment).not.toHaveBeenCalled();
    });

    it('已 Settled 的重复回调：不再结算，返回 200 SUCCESS', async () => {
        const { ctrl, orderService } = makeController({
            channels: baseChannels,
            order: orderInCh7,
            payments: [{ id: 7, state: 'Settled', amount: 1000 }],
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('并发下已被抢先结算：幂等成功返回 200', async () => {
        const { ctrl } = makeController({
            channels: baseChannels,
            order: orderInCh7,
            payments: [{ id: 7, state: 'Authorized', amount: 1000 }],
            paymentRow: { id: 7, state: 'Settled' },
            settleImpl: async () => ({
                __typename: 'SettlePaymentError',
                errorCode: 'SETTLE_PAYMENT_ERROR',
                message: 'already settled',
            }),
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, notifyBody);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('非 TRANSACTION.SUCCESS 事件：仅确认，不结算', async () => {
        const { ctrl, orderService } = makeController({
            channels: baseChannels,
            order: orderInCh7,
        });
        const res = makeRes();
        await ctrl.notify({ headers: notifyHeaders } as any, res, {
            ...notifyBody,
            event_type: 'REFUND.SUCCESS',
        });
        expect(orderService.settlePayment).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('缺少签名头：返回 400 FAIL', async () => {
        const { ctrl } = makeController({ channels: baseChannels, order: orderInCh7 });
        const res = makeRes();
        await ctrl.notify({ headers: {} } as any, res, notifyBody);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});
