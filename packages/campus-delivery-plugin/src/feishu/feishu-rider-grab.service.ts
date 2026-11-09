import { Injectable } from '@nestjs/common';
import { Logger, Order, RequestContextService, TransactionalConnection } from '@vendure/core';

import { HallGrabService } from '../hall-grab.service';
import { RiderService } from '../rider.service';
import { FeishuClient } from './feishu.client';
import { FeishuConfigService } from './feishu.config';

const loggerCtx = 'Feishu';

/**
 * 骑手群抢单回调：飞书 open_id → 骑手 Customer → 构造带 activeUserId 的 ctx → 复用 HallGrabService.grab。
 * 权限判定全部落在 grab → assertApprovedRider（骑手状态/信用分/合规），本服务不重复实现。
 * 与商家群指令隔离：本服务只认 scope='rider' 的群和 rider_grab 动作，绝不转发给 FeishuCommandService。
 */
@Injectable()
export class FeishuRiderGrabService {
    constructor(
        private cfg: FeishuConfigService,
        private client: FeishuClient,
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
        private riderService: RiderService,
        private hallGrab: HallGrabService,
    ) {}

    /** 骑手群判定（事件层分流用） */
    isRiderChat(chatId: string): boolean {
        return this.cfg.chatOf(chatId)?.scope === 'rider';
    }

    /** 骑手群文本消息：只提示点卡片按钮，不解析任何指令（避免复用商家指令面） */
    async handleText(input: { chatId: string; openId: string; text?: string }): Promise<void> {
        if (!this.client.riderEnabled) return;
        if (!this.isRiderChat(input.chatId)) return;
        await this.client.sendToChat(
            input.chatId,
            '骑手群仅支持点击「新单待抢」卡片上的「抢单」按钮，暂不支持文本指令。',
            { app: 'rider' },
        );
    }

    /** 卡片回调：校验群 scope 与动作 → 反查骑手 → 抢单 → 回执（全部走骑手独立应用） */
    async handleCardAction(input: {
        chatId: string;
        openId: string;
        value?: any;
        messageId?: string;
    }): Promise<void> {
        const { chatId, openId, messageId } = input;
        if (!this.client.riderEnabled) return;
        // 双重保险：事件层已按 scope 分流，这里再拒绝非骑手群，防止误配后被当成骑手回调
        if (!this.isRiderChat(chatId)) {
            Logger.warn(`非骑手群收到 rider_grab 回调，已拒绝 chat=${chatId}`, loggerCtx);
            return;
        }
        const action = String(input.value?.a ?? '');
        if (action !== 'rider_grab') {
            await this.reply(chatId, messageId, '不支持的卡片操作。');
            return;
        }
        const code = typeof input.value?.c === 'string' ? input.value.c : '';
        if (!code) {
            await this.reply(chatId, messageId, '卡片缺少订单信息，请使用最新推送的抢单卡片。');
            return;
        }

        const riderAppId = String(this.cfg.settings.riderAppId ?? '');
        const resolution = await this.riderService.resolveFeishuRider(openId, riderAppId);
        switch (resolution.kind) {
            case 'unbound':
                // 运营补绑需要能定位到人：打出 open_id + 群/消息锚点（后台可按 open_id 查飞书通讯录）
                Logger.warn(
                    `飞书抢单未绑定骑手 open_id=${openId} app=${riderAppId || '-'} chat=${chatId} `
                    + `message=${messageId ?? '-'} order=${code}`,
                    loggerCtx,
                );
                await this.reply(
                    chatId,
                    messageId,
                    '你的飞书账号尚未绑定骑手身份，请联系运营绑定后重试。',
                );
                return;
            case 'legacyBinding':
                Logger.warn(
                    `飞书抢单绑定已失效（缺少应用标识或来自旧应用） open_id=${openId} app=${riderAppId || '-'} `
                    + `chat=${chatId} message=${messageId ?? '-'} order=${code}；请运营解绑后重新绑定`,
                    loggerCtx,
                );
                await this.reply(
                    chatId,
                    messageId,
                    '你的飞书绑定来自旧应用或缺少应用标识，已失效，请联系运营重新绑定后重试。',
                );
                return;
            case 'conflict':
                await this.reply(
                    chatId,
                    messageId,
                    '你的飞书账号存在多条骑手绑定，请联系运营解绑多余绑定后重试。',
                );
                return;
            case 'notApproved':
                await this.reply(
                    chatId,
                    messageId,
                    '你的骑手账号未通过审核或已停用，暂不能抢单。',
                );
                return;
            default:
                break;
        }
        const customer = resolution.customer;
        const user = (customer as any).user;
        if (!user) {
            Logger.warn(`骑手 ${customer.id} 未关联登录用户，无法构造抢单上下文`, loggerCtx);
            await this.reply(chatId, messageId, '你的骑手账号缺少登录信息，请联系运营处理。');
            return;
        }

        const order = await this.connection.rawConnection.getRepository(Order).findOne({
            where: { code },
            relations: ['channels'],
        });
        if (!order) {
            await this.reply(chatId, messageId, `未找到订单：${code}`);
            return;
        }
        // 卡片 value 同时带订单主键，双校验防止旧卡片/伪造单号串单
        const cardOrderId = input.value?.o;
        if (cardOrderId != null && String(order.id) !== String(cardOrderId)) {
            await this.reply(chatId, messageId, '卡片与订单不匹配，请使用最新推送的抢单卡片。');
            return;
        }
        const channel = order.channels?.[0];
        if (!channel) {
            Logger.warn(`订单 ${code} 未绑定渠道，无法抢单`, loggerCtx);
            await this.reply(chatId, messageId, '该订单未绑定店铺，暂时无法抢单。');
            return;
        }

        try {
            const ctx = await this.requestContextService.create({
                apiType: 'admin',
                channelOrToken: channel.token,
                user,
            });
            const grabbed = await this.hallGrab.grab(ctx, order.id);
            Logger.info(`飞书抢单成功 chat=${chatId} open_id=${openId} rider=${customer.id} order=${grabbed.code}`, loggerCtx);
            await this.reply(chatId, messageId, `抢单成功：${grabbed.code}，请尽快前往商家取餐。`);
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            Logger.info(`飞书抢单失败 chat=${chatId} open_id=${openId} order=${code} result=${msg}`, loggerCtx);
            await this.reply(chatId, messageId, `抢单失败：${msg}`);
        }
    }

    /** 优先回在卡片话题里，拿不到锚点消息时退回群消息；统一走骑手独立应用 */
    private async reply(chatId: string, messageId: string | undefined, text: string): Promise<void> {
        if (messageId) {
            try {
                if (await this.client.replyToMessage(messageId, text, true, 'rider')) return;
            } catch (e: any) {
                Logger.warn(`飞书骑手回执线程回复失败 anchor=${messageId}: ${e?.message ?? e}`, loggerCtx);
            }
        }
        await this.client.sendToChat(chatId, text, { app: 'rider' });
    }
}
