// 飞书抢单通知单测：骑手群隔离、open_id 四态反查、抢单回调、去重键、缺群只告警
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { FeishuClient } from './feishu/feishu.client';
import { FeishuCommandService } from './feishu/feishu.command.service';
import { FeishuConfigService, parseChatMap } from './feishu/feishu.config';
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

    it('未绑定 / 一绑多 / 已绑未过审 / 可用', async () => {
        expect((await svcWith([]).resolveFeishuRider('ou_1')).kind).toBe('unbound');
        expect((await svcWith([{ id: 1 }, { id: 2 }]).resolveFeishuRider('ou_1')).kind).toBe('conflict');
        expect((await svcWith([{ id: 1, customFields: { riderStatus: 'pending' } }]).resolveFeishuRider('ou_1')).kind).toBe('notApproved');
        expect((await svcWith([{ id: 1, customFields: { riderStatus: 'approved' } }]).resolveFeishuRider('ou_1')).kind).toBe('ok');
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
            replyToMessage: vi.fn().mockResolvedValue(true),
            sendToChat: vi.fn().mockResolvedValue(true),
        };
        const connection = {
            rawConnection: { getRepository: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(order) }) },
        };
        const cfg = { chatOf: overrides.chatOf ?? ((id: string) => (id === 'oc_rider' ? riderChat : undefined)) };
        const ctx = { activeUserId: 7 };
        const requestContextService = { create: vi.fn().mockResolvedValue(ctx) };
        const riderService = { resolveFeishuRider: vi.fn().mockResolvedValue(overrides.resolution ?? { kind: 'ok', customer: { id: 5, user: { id: 7 } } }) };
        const hallGrab = { grab: overrides.grab ?? vi.fn().mockResolvedValue({ code: 'S1' }) };
        const svc = new FeishuRiderGrabService(
            cfg as any, client as any, connection as any, requestContextService as any, riderService as any, hallGrab as any,
        );
        return { svc, client, hallGrab, requestContextService, ctx };
    }

    it('成功：用绑定 Customer 的 user 构造 ctx 并复用 grab', async () => {
        const env = makeSvc();
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_1', value: { a: 'rider_grab', c: 'S1', o: '11' }, messageId: 'm1' });
        expect(env.requestContextService.create).toHaveBeenCalledWith({ apiType: 'admin', channelOrToken: 't1', user: { id: 7 } });
        expect(env.hallGrab.grab).toHaveBeenCalledWith(env.ctx, 11);
        expect(env.client.replyToMessage.mock.calls[0][1]).toContain('抢单成功');
    });

    it('未绑定：回执提示找运营绑定，不调用 grab', async () => {
        const env = makeSvc({ resolution: { kind: 'unbound' } });
        await env.svc.handleCardAction({ chatId: 'oc_rider', openId: 'ou_x', value: { a: 'rider_grab', c: 'S1' } });
        expect(env.hallGrab.grab).not.toHaveBeenCalled();
        expect(env.client.sendToChat.mock.calls[0][1]).toContain('尚未绑定');
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
    function makeEvent() {
        const cfg = {
            enabled: true,
            settings: { verifyToken: 'tok', encryptKey: undefined, chats: { oc_rider: riderChat, oc_shop: { scope: 'channel', channel: 't1', operators: ['ou_op'], owners: [] } } },
            chatOf: (id: string) => (id === 'oc_rider' ? riderChat : undefined),
        } as any;
        const command = { handleMessage: vi.fn().mockResolvedValue(undefined), handleCardAction: vi.fn().mockResolvedValue(undefined) };
        const riderGrab = { handleText: vi.fn().mockResolvedValue(undefined), handleCardAction: vi.fn().mockResolvedValue(undefined) };
        const svc = new FeishuEventService(cfg, command as any, undefined, riderGrab as any);
        return { svc, command, riderGrab };
    }

    it('骑手群文本 → 只走骑手服务，不进指令服务', async () => {
        const env = makeEvent();
        await env.svc.handle({
            header: { event_type: 'im.message.receive_v1', token: 'tok', event_id: 'e1' },
            event: {
                message: { message_type: 'text', chat_id: 'oc_rider', content: JSON.stringify({ text: '接单 A1234' }) },
                sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
            },
        });
        expect(env.riderGrab.handleText).toHaveBeenCalledTimes(1);
        expect(env.command.handleMessage).not.toHaveBeenCalled();
    });

    it('骑手群卡片 → 只走抢单回调，不进商家指令服务', async () => {
        const env = makeEvent();
        await env.svc.handle({
            header: { event_type: 'card.action.trigger', token: 'tok', event_id: 'e2' },
            event: {
                context: { open_chat_id: 'oc_rider', open_message_id: 'm1' },
                operator: { open_id: 'ou_1' },
                action: { value: { a: 'accept', c: 'S1' } },
            },
        });
        expect(env.riderGrab.handleCardAction).toHaveBeenCalledTimes(1);
        expect(env.command.handleCardAction).not.toHaveBeenCalled();
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

describe('缺骑手群配置只告警不崩', () => {
    it('未配置骑手群 → 不生成卡片、不发送、不抛错', async () => {
        const client = { enabled: true, riderChatIds: [], broadcastRiderCard: vi.fn() };
        const cards = { buildRiderGrabCard: vi.fn() };
        const svc = new FeishuNotifyService(client as any, cards as any);
        await expect(svc.pushRiderGrab('S1')).resolves.toBeUndefined();
        expect(cards.buildRiderGrabCard).not.toHaveBeenCalled();
        expect(client.broadcastRiderCard).not.toHaveBeenCalled();
    });

    it('已配置骑手群 → 生成并广播卡片', async () => {
        const client = { enabled: true, riderChatIds: ['oc_rider'], broadcastRiderCard: vi.fn().mockResolvedValue(1) };
        const cards = { buildRiderGrabCard: vi.fn().mockResolvedValue({ card: true }) };
        const svc = new FeishuNotifyService(client as any, cards as any);
        await svc.pushRiderGrab('S1');
        expect(cards.buildRiderGrabCard).toHaveBeenCalledWith('S1');
        expect(client.broadcastRiderCard).toHaveBeenCalledWith({ card: true });
    });
});
