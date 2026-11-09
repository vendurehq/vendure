// 飞书抢单通知单测：骑手群隔离、open_id 四态反查、抢单回调、去重键、缺群只告警
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { FeishuClient } from './feishu/feishu.client';
import { FeishuCommandService } from './feishu/feishu.command.service';
import { FeishuConfigService, parseChatMap, readFeishuSettings } from './feishu/feishu.config';
import { FeishuEventService } from './feishu/feishu.event.service';
import { FeishuNotifyService } from './feishu/feishu-notify.service';
import { FeishuRiderGrabService } from './feishu/feishu-rider-grab.service';
import { HallService, riderGrabDedupeKey } from './hall.service';
import { RiderService } from './rider.service';

const riderChat = { scope: 'rider' as const, operators: [], owners: [] };

function fuzzyDedupe() {
    const seen = new Set<string>();
    return {
        seenOrMark: vi.fn(async (key: string) => {
            if (seen.has(key)) return true;
            seen.add(key);
            return false;
        }),
    };
}

describe('骑手群配置与广播隔离', () => {
    it('scope=rider 不要求 channel，也能被识别为骑手群', () => {
        const map = parseChatMap(JSON.stringify({ oc_rider: { scope: 'rider' } }));
        expect(map.oc_rider.scope).toBe('rider');
        expect(map.oc_rider.channel).toBeUndefined();
    });

    it('普通广播 chatIdsFor 排除骑手群，riderChatIds 单独返回', () => {
        const cfg = {
            enabled: true,
            settings: {
                chats: {
                    oc_shop: { scope: 'channel', channel: 't1', operators: [], owners: [] },
                    oc_platform: { scope: 'platform', operators: [], owners: [] },
                    oc_rider: riderChat,
                },
            },
            riderChatIds: ['oc_rider'],
        } as any;
        const client = new FeishuClient(cfg);
        expect(client.chatIdsFor('t1')).toEqual(['oc_shop', 'oc_platform']);
        expect(client.chatIdsFor()).not.toContain('oc_rider');
        expect(client.riderChatIds).toEqual(['oc_rider']);
    });
});

describe('抢单去重键', () => {
    it('同一单同一次入厅 → 同一键（多路径只推一次）', () => {
        const t = new Date('2026-11-09T10:00:00+08:00');
        expect(riderGrabDedupeKey(9, t)).toBe(riderGrabDedupeKey(9, new Date(t.getTime())));
    });

    it('回池后重新入厅（入厅时刻变化）→ 新键，允许再推', () => {
        const first = new Date('2026-11-09T10:00:00+08:00');
        const second = new Date(first.getTime() + 5 * 60_000);
        expect(riderGrabDedupeKey(9, first)).not.toBe(riderGrabDedupeKey(9, second));
    });

    it('HallService：同次入厅只推一次，新的入厅时刻可再推', async () => {
        const feishu = { enabled: true, pushRiderGrab: vi.fn().mockResolvedValue(undefined) };
        const dedupe = fuzzyDedupe();
        const svc = new HallService({} as any, {} as any, { get: vi.fn() } as any, {} as any, feishu as any, undefined, dedupe as any);
        const order = { id: 9, code: 'S1', customFields: {} } as any;
        const enteredAt = new Date('2026-11-09T10:00:00+08:00');
        await (svc as any).pushFeishuRiderGrab(order, enteredAt);
        await (svc as any).pushFeishuRiderGrab(order, new Date(enteredAt.getTime()));
        expect(feishu.pushRiderGrab).toHaveBeenCalledTimes(1);
        await (svc as any).pushFeishuRiderGrab(order, new Date(enteredAt.getTime() + 60_000));
        expect(feishu.pushRiderGrab).toHaveBeenCalledTimes(2);
    });

    it('owned_pool 入厅不推骑手群', async () => {
        const feishu = { enabled: true, pushRiderGrab: vi.fn().mockResolvedValue(undefined) };
        const svc = new HallService({} as any, {} as any, { get: vi.fn() } as any, {} as any, feishu as any);
        (svc as any).notifyRiders({ channel: {}, channelId: 1 } as any, { id: 9, code: 'S1', customFields: {} } as any, 'owned_pool', new Date());
        await Promise.resolve();
        expect(feishu.pushRiderGrab).not.toHaveBeenCalled();
    });
});

describe('open_id 反查骑手四态', () => {
    function svcWith(rows: any[]) {
        const qb = {
            leftJoinAndSelect: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            getMany: vi.fn().mockResolvedValue(rows),
        };
        const conn = { rawConnection: { getRepository: vi.fn().mockReturnValue({ createQueryBuilder: vi.fn().mockReturnValue(qb) }) } };
        return new RiderService(conn as any, {} as any, {} as any);
    }

    const app = 'cli_rider_app';

    it('未绑定 / 一绑多 / 已绑未过审 / 可用（同一应用）', async () => {
        expect((await svcWith([]).resolveFeishuRider('ou_1', app)).kind).toBe('unbound');
        expect((await svcWith([
            { id: 1, customFields: { riderFeishuAppId: app } },
            { id: 2, customFields: { riderFeishuAppId: app } },
        ]).resolveFeishuRider('ou_1', app)).kind).toBe('conflict');
        expect((await svcWith([{ id: 1, customFields: { riderFeishuAppId: app, riderStatus: 'pending' } }]).resolveFeishuRider('ou_1', app)).kind).toBe('notApproved');
        expect((await svcWith([{ id: 1, customFields: { riderFeishuAppId: app, riderStatus: 'approved' } }]).resolveFeishuRider('ou_1', app)).kind).toBe('ok');
    });

    it('老绑定没有 appId 或来自其他应用 → legacyBinding（必须重绑）', async () => {
        expect((await svcWith([{ id: 1, customFields: { riderStatus: 'approved' } }]).resolveFeishuRider('ou_1', app)).kind).toBe('legacyBinding');
        expect((await svcWith([{ id: 1, customFields: { riderFeishuAppId: 'cli_ops_app', riderStatus: 'approved' } }]).resolveFeishuRider('ou_1', app)).kind).toBe('legacyBinding');
        // 未传 appId 时无法按应用匹配，一律视为失效
        expect((await svcWith([{ id: 1, customFields: { riderFeishuAppId: app, riderStatus: 'approved' } }]).resolveFeishuRider('ou_1')).kind).toBe('legacyBinding');
    });
});

describe('抢单卡片回调', () => {
    const order = { id: 11, code: 'S1', channels: [{ token: 't1' }] };

    function makeSvc(overrides: {
        resolution?: any;
        grab?: any;
        chatOf?: (id: string) => any;
    } = {}) {
        const client = {
            enabled: true,
            riderEnabled: true,
            replyToMessage: vi.fn().mockResolvedValue(true),
            sendToChat: vi.fn().mockResolvedValue(true),
        };
        const connection = {
            rawConnection: { getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(order) }) },
        };
        const cfg = {
            settings: { riderAppId: 'cli_rider_app' },
            chatOf: overrides.chatOf ?? ((id: string) => (id === 'oc_rider' ? riderChat : undefined)),
        };
        const ctx = { activeUserId: 7 };
        const requestContextService = { create: vi.fn().mockResolvedValue(ctx) };
        const riderService = { resolveFeishuRider: vi.fn().mockResolvedValue(overrides.resolution ?? { kind: 'ok', customer: { id: 5, user: { id: 7 } } }) };
        const hallGrab = { grab: overrides.grab ?? vi.fn().mockResolvedValue({ code: 'S1' }) };
        const svc = new FeishuRiderGrabService(
            cfg as any, client as any, connection as any, requestContextService as any, riderService as any, hallGrab as any,
        );
        return { svc, client, hallGrab, requestContextService, ctx, riderService };
    }

    it('成功：用绑定 Customer 的 user 构造 ctx 并复用 grab', async () => {
        const env = makeSvc();
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_1', value: { a: 'rider_grab', c: 'S1', o: '11' }, messageId: 'm1' });
        expect(env.riderService.resolveFeishuRider).toHaveBeenCalledWith('ou_1', 'cli_rider_app');
        expect(env.requestContextService.create).toHaveBeenCalledWith({ apiType: 'admin', channelOrToken: 't1', user: { id: 7 } });
        expect(env.hallGrab.grab).toHaveBeenCalledWith(env.ctx, 11);
        expect(env.client.replyToMessage.mock.calls[0][1]).toContain('抢单成功');
        // 回执必须走骑手独立应用
        expect(env.client.replyToMessage.mock.calls[0][3]).toBe('rider');
    });

    it('未绑定：回执提示找运营绑定，不调用 grab', async () => {
        const env = makeSvc({ resolution: { kind: 'unbound' } });
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_x', value: { a: 'rider_grab', c: 'S1' } });
        expect(env.hallGrab.grab).not.toHaveBeenCalled();
        expect(env.client.sendToChat.mock.calls[0][1]).toContain('尚未绑定');
        expect(env.client.sendToChat.mock.calls[0][2]).toEqual({ app: 'rider' });
    });

    it('旧应用绑定失效：提示重新绑定，不调用 grab', async () => {
        const env = makeSvc({ resolution: { kind: 'legacyBinding' } });
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_x', value: { a: 'rider_grab', c: 'S1' } });
        expect(env.hallGrab.grab).not.toHaveBeenCalled();
        expect(env.client.sendToChat.mock.calls[0][1]).toContain('已失效');
    });

    it('绑定冲突：不猜身份，回执提示解绑', async () => {
        const env = makeSvc({ resolution: { kind: 'conflict' } });
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_x', value: { a: 'rider_grab', c: 'S1' } });
        expect(env.hallGrab.grab).not.toHaveBeenCalled();
        expect(env.client.sendToChat.mock.calls[0][1]).toContain('多条骑手绑定');
    });

    it('未过审：不调用 grab', async () => {
        const env = makeSvc({ resolution: { kind: 'notApproved', customer: { id: 5 } } });
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_x', value: { a: 'rider_grab', c: 'S1' } });
        expect(env.hallGrab.grab).not.toHaveBeenCalled();
        expect(env.client.sendToChat.mock.calls[0][1]).toContain('未通过审核');
    });

    it('手慢/越权等业务异常回执，不外抛', async () => {
        const env = makeSvc({ grab: vi.fn().mockRejectedValue(new Error('手慢了，该订单已被抢')) });
        await expect(env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_1', value: { a: 'rider_grab', c: 'S1' } })).resolves.toBeUndefined();
        expect(env.client.sendToChat.mock.calls[0][1]).toContain('抢单失败：手慢了');
    });

    it('非骑手群一律忽略（不抢单不回执）', async () => {
        const env = makeSvc({ chatOf: () => undefined });
        await env.svc.handleCardAction({ chatId: 'oc_shop', openId: 'ou_1', value: { a: 'rider_grab', c: 'S1' } });
        expect(env.hallGrab.grab).not.toHaveBeenCalled();
        expect(env.client.replyToMessage).not.toHaveBeenCalled();
    });
});

describe('事件层按群定位分流（骑手群不得执行商家指令）', () => {
    const shop = { scope: 'channel', channel: 't1', operators: ['ou_op'], owners: [] };
    function makeEvent() {
        const cfg = {
            enabled: true,
            settings: {
                appId: 'cli_ops_app',
                appSecret: 'ops_secret',
                verifyToken: 'tok_ops',
                encryptKey: undefined,
                riderAppId: 'cli_rider_app',
                riderAppSecret: 'rider_secret',
                riderVerifyToken: 'tok_rider',
                riderEncryptKey: undefined,
                chats: { oc_rider: riderChat, oc_shop: shop },
            },
            chatOf: (id: string) => (id === 'oc_rider' ? riderChat : id === 'oc_shop' ? shop : undefined),
        } as any;
        const command = { handleMessage: vi.fn().mockResolvedValue(undefined), handleCardAction: vi.fn().mockResolvedValue(undefined) };
        const riderGrab = { handleText: vi.fn().mockResolvedValue(undefined), handleCardAction: vi.fn().mockResolvedValue(undefined) };
        const svc = new FeishuEventService(cfg, command as any, undefined, riderGrab as any);
        return { svc, command, riderGrab };
    }

    it('骑手应用回调：骑手群文本 → 只走骑手服务，不进指令服务', async () => {
        const env = makeEvent();
        await env.svc.handle({
            header: { event_type: 'im.message.receive_v1', token: 'tok_rider', event_id: 'e1' },
            event: {
                message: { message_type: 'text', chat_id: 'oc_rider', content: JSON.stringify({ text: '接单 A1234' }) },
                sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
            },
        }, undefined, 'rider');
        expect(env.riderGrab.handleText).toHaveBeenCalledTimes(1);
        expect(env.command.handleMessage).not.toHaveBeenCalled();
    });

    it('骑手应用回调：骑手群卡片 → 只走抢单回调，不进商家指令服务', async () => {
        const env = makeEvent();
        await env.svc.handle({
            header: { event_type: 'card.action.trigger', token: 'tok_rider', event_id: 'e2' },
            event: {
                context: { open_chat_id: 'oc_rider', open_message_id: 'm1' },
                operator: { open_id: 'ou_1' },
                action: { value: { a: 'accept', c: 'S1' } },
            },
        }, undefined, 'rider');
        expect(env.riderGrab.handleCardAction).toHaveBeenCalledTimes(1);
        expect(env.command.handleCardAction).not.toHaveBeenCalled();
    });

    it('运维回调不接收骑手群事件（彻底分离）', async () => {
        const env = makeEvent();
        await env.svc.handle({
            header: { event_type: 'card.action.trigger', token: 'tok_ops', event_id: 'e3' },
            event: {
                context: { open_chat_id: 'oc_rider', open_message_id: 'm1' },
                operator: { open_id: 'ou_1' },
                action: { value: { a: 'rider_grab', c: 'S1' } },
            },
        });
        expect(env.riderGrab.handleCardAction).not.toHaveBeenCalled();
        expect(env.command.handleCardAction).not.toHaveBeenCalled();
    });

    it('回调 token 按应用隔离：骑手路由不认运维 token，反之亦然', async () => {
        const env = makeEvent();
        const riderBody = {
            header: { event_type: 'im.message.receive_v1', token: 'tok_ops', event_id: 'e4' },
            event: {
                message: { message_type: 'text', chat_id: 'oc_rider', content: JSON.stringify({ text: 'hi' }) },
                sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
            },
        };
        expect((await env.svc.handle(riderBody, undefined, 'rider')).status).toBe(403);
        expect(env.riderGrab.handleText).not.toHaveBeenCalled();
    });

    it('骑手应用未配置 → 回调 503 降级关闭，不影响运维回调', async () => {
        const env = makeEvent();
        (env.svc as any).cfg.settings.riderAppSecret = undefined;
        expect((await env.svc.handle({ header: { event_type: 'im.message.receive_v1', token: 'tok_rider' } }, undefined, 'rider')).status).toBe(503);
    });
});

describe('FeishuCommandService 防御性拒绝骑手群', () => {
    it('骑手群文本/卡片均直接忽略', async () => {
        const cfg = { chatOf: (id: string) => (id === 'oc_rider' ? riderChat : undefined) } as any;
        const client = { enabled: true, sendToChat: vi.fn() } as any;
        const svc = new FeishuCommandService(
            cfg as FeishuConfigService, client as FeishuClient,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        await svc.handleMessage({ chatId: 'oc_rider', openId: 'ou_1', text: '接单 A1234' });
        await svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_1', value: { a: 'accept', c: 'S1' } });
        expect(client.sendToChat).not.toHaveBeenCalled();
    });
});

describe('双应用凭证与 token 分槽（B 方案）', () => {
    it('解析骑手应用四项环境变量，与运维应用并存', () => {
        const s = readFeishuSettings({
            FEISHU_ENABLED: 'true',
            FEISHU_APP_ID: 'cli_ops',
            FEISHU_APP_SECRET: 'ops_secret',
            FEISHU_VERIFY_TOKEN: 'ops_tok',
            FEISHU_RIDER_APP_ID: 'cli_rider',
            FEISHU_RIDER_APP_SECRET: 'rider_secret',
            FEISHU_RIDER_VERIFY_TOKEN: 'rider_tok',
            FEISHU_RIDER_ENCRYPT_KEY: 'rider_key',
            FEISHU_CHAT_MAP: JSON.stringify({ oc_rider: { scope: 'rider' } }),
        } as any);
        expect(s.appId).toBe('cli_ops');
        expect(s.riderAppId).toBe('cli_rider');
        expect(s.riderAppSecret).toBe('rider_secret');
        expect(s.riderVerifyToken).toBe('rider_tok');
        expect(s.riderEncryptKey).toBe('rider_key');
    });

    it('tenant_access_token 按 appId 分槽，ops/rider 互不覆盖', async () => {
        const cfg = {
            enabled: true,
            settings: {
                appId: 'cli_ops',
                appSecret: 'ops_secret',
                riderAppId: 'cli_rider',
                riderAppSecret: 'rider_secret',
                chats: {},
            },
        } as any;
        const client = new FeishuClient(cfg);
        const fetchMock = vi.fn(async (url: string, init: any) => {
            if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
                const body = JSON.parse(init.body);
                return {
                    ok: true,
                    json: async () => ({ code: 0, tenant_access_token: `token_${body.app_id}`, expire: 7200 }),
                };
            }
            return { ok: true, json: async () => ({ code: 0, data: { message_id: 'm' } }) };
        });
        vi.stubGlobal('fetch', fetchMock);
        try {
            await client.sendCard('oc_ops', { c: 1 }, 'ops');
            await client.sendCard('oc_rider', { c: 2 }, 'rider');
            await client.sendCard('oc_ops', { c: 3 }, 'ops');

            const auths = fetchMock.mock.calls
                .filter(c => String(c[0]).includes('/im/v1/messages'))
                .map(c => (c[1] as any).headers.Authorization);
            expect(auths).toEqual(['Bearer token_cli_ops', 'Bearer token_cli_rider', 'Bearer token_cli_ops']);

            const tokenCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('tenant_access_token'));
            expect(tokenCalls).toHaveLength(2);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('抢单卡片广播只走骑手应用 token', async () => {
        const cfg = {
            enabled: true,
            riderChatIds: ['oc_rider'],
            settings: {
                appId: 'cli_ops',
                appSecret: 'ops_secret',
                riderAppId: 'cli_rider',
                riderAppSecret: 'rider_secret',
                chats: { oc_rider: { scope: 'rider' } },
            },
        } as any;
        const client = new FeishuClient(cfg);
        const fetchMock = vi.fn(async (url: string, init: any) => {
            if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
                const body = JSON.parse(init.body);
                return {
                    ok: true,
                    json: async () => ({ code: 0, tenant_access_token: `token_${body.app_id}`, expire: 7200 }),
                };
            }
            return { ok: true, json: async () => ({ code: 0, data: { message_id: 'm' } }) };
        });
        vi.stubGlobal('fetch', fetchMock);
        try {
            await expect(client.broadcastRiderCard({ card: true })).resolves.toBe(1);
            const auth = fetchMock.mock.calls
                .filter(c => String(c[0]).includes('/im/v1/messages'))
                .map(c => (c[1] as any).headers.Authorization);
            expect(auth).toEqual(['Bearer token_cli_rider']);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('未配置骑手应用时 riderEnabled=false，骑手消息不发送', async () => {
        const cfg = {
            enabled: true,
            settings: { appId: 'cli_ops', appSecret: 'ops_secret', chats: {} },
        } as any;
        const client = new FeishuClient(cfg);
        expect(client.riderEnabled).toBe(false);
        await expect(client.sendCard('oc_rider', {}, 'rider')).resolves.toBeNull();
    });
});

describe('缺骑手群配置只告警不崩', () => {
    it('未配置骑手群 → 不生成卡片、不发送、不抛错', async () => {
        const client = { enabled: true, riderEnabled: true, riderChatIds: [], broadcastRiderCard: vi.fn() };
        const cards = { buildRiderGrabCard: vi.fn() };
        const svc = new FeishuNotifyService(client as any, cards as any);
        await expect(svc.pushRiderGrab('S1')).resolves.toBeUndefined();
        expect(cards.buildRiderGrabCard).not.toHaveBeenCalled();
        expect(client.broadcastRiderCard).not.toHaveBeenCalled();
    });

    it('未配置骑手应用 → 降级关闭（不生成、不发送、不抛错）', async () => {
        const client = { enabled: true, riderEnabled: false, riderChatIds: ['oc_rider'], broadcastRiderCard: vi.fn() };
        const cards = { buildRiderGrabCard: vi.fn() };
        const svc = new FeishuNotifyService(client as any, cards as any);
        await expect(svc.pushRiderGrab('S1')).resolves.toBeUndefined();
        expect(cards.buildRiderGrabCard).not.toHaveBeenCalled();
        expect(client.broadcastRiderCard).not.toHaveBeenCalled();
    });

    it('已配置骑手群 → 生成并广播卡片', async () => {
        const client = { enabled: true, riderEnabled: true, riderChatIds: ['oc_rider'], broadcastRiderCard: vi.fn().mockResolvedValue(1) };
        const cards = { buildRiderGrabCard: vi.fn().mockResolvedValue({ card: true }) };
        const svc = new FeishuNotifyService(client as any, cards as any);
        await svc.pushRiderGrab('S1');
        expect(cards.buildRiderGrabCard).toHaveBeenCalledWith('S1');
        expect(client.broadcastRiderCard).toHaveBeenCalledWith({ card: true });
    });
});
