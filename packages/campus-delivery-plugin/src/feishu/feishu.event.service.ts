import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';

import { CampusDedupeService } from '../campus-dedupe.service';
import { FeishuCommandService } from './feishu.command.service';
import { FeishuConfigService } from './feishu.config';
import { FeishuApp } from './feishu.client';
import { FeishuRiderGrabService } from './feishu-rider-grab.service';
import { decryptFeishuPayload, feishuSignature, signatureEquals } from './feishu.crypto';

const loggerCtx = 'Feishu';
const EVENT_DEDUPE_MS = 10 * 60_000;
/** 签名时间戳容忍窗口：飞书建议 1 小时内；重放由 event_id 去重兜底 */
const SIGNATURE_TOLERANCE_SECONDS = 60 * 60;

export interface FeishuEventResult {
    status: number;
    body: Record<string, unknown>;
}

/** 飞书回调签名头（配置 Encrypt Key 后由飞书下发） */
export interface FeishuRequestHeaders {
    timestamp?: string;
    nonce?: string;
    signature?: string;
}

/**
 * 飞书事件订阅入口：URL 验证（challenge）→ 可选解密 → token 校验 → event_id 去重 → 异步执行指令。
 * 先返回 200 再处理业务：飞书 3 秒超时会重试，重试叠加接单/退款很难看；真正的幂等由领域层保证。
 */
@Injectable()
export class FeishuEventService {
    private seen = new Map<string, number>();

    constructor(
        private cfg: FeishuConfigService,
        private command: FeishuCommandService,
        /** M5 跨实例事件去重（飞书重试可能落到另一实例）；未注入退回进程内 Map */
        private dedupe?: CampusDedupeService,
        /** 骑手群抢单回调（scope='rider'）；事件层按群定位分流，绝不与商家指令共用通道 */
        private riderGrab?: FeishuRiderGrabService,
    ) {}

    /**
     * @param app 回调所属应用：ops=运维告警应用（/feishu/event），rider=骑手独立应用（/feishu/rider/event）。
     *            验签、解密与 token 校验只使用该应用自己的凭证，两个应用的加密回调彻底隔离。
     */
    async handle(raw: any, headers?: FeishuRequestHeaders, app: FeishuApp = 'ops'): Promise<FeishuEventResult> {
        if (!this.cfg.enabled) return { status: 200, body: {} };

        const appCfg = this.appConfig(app);
        if (!appCfg) {
            if (app === 'rider') {
                Logger.warn('骑手飞书回调不可用：未配置 FEISHU_RIDER_APP_ID/SECRET 或 FEISHU_ENABLED 未开启', loggerCtx);
                return { status: 503, body: { error: 'rider feishu app not configured' } };
            }
            return { status: 200, body: {} };
        }

        // H3：配置 Encrypt Key 时飞书会带签名头，必须先验签再解密，避免伪造/重放回调绕过 verifyToken
        if (!this.verifySignature(raw, headers, appCfg.encryptKey)) return { status: 403, body: {} };

        const payload = await this.decode(raw, appCfg.encryptKey);
        if (!payload) return { status: 400, body: { error: 'invalid payload' } };

        // 卡片回调的事件体有时把 token 放在 event.token，两处都取
        const token = payload?.header?.token ?? payload?.event?.token ?? payload?.token;
        // URL 验证是纯握手（不回显任何业务数据），先放行，避免控制台保存回调地址被 token 挡住
        if (payload?.challenge) {
            return { status: 200, body: { challenge: payload.challenge } };
        }
        // fail closed：未配置 verifyToken 时任何人都能伪造回调，直接拒绝
        const allowed = this.verifyTokens(appCfg.verifyToken);
        if (!allowed.length) {
            Logger.error(
                app === 'rider'
                    ? '未配置 FEISHU_RIDER_VERIFY_TOKEN，拒绝骑手飞书回调'
                    : '未配置 FEISHU_VERIFY_TOKEN，拒绝飞书回调',
                loggerCtx,
            );
            return { status: 403, body: {} };
        }
        if (typeof token !== 'string' || !allowed.includes(token)) {
            // 不打印 token 原文，只暴露事件类型与长度便于排查是哪个回调的验证令牌
            Logger.warn(
                `飞书回调 token 校验失败 app=${app} type=${payload?.header?.event_type ?? '-'} tokenLen=${
                    typeof token === 'string' ? token.length : 'none'
                }`,
                loggerCtx,
            );
            return { status: 403, body: {} };
        }

        const eventId = payload?.header?.event_id as string | undefined;
        if (eventId && (await this.isDuplicate(`${app}:${eventId}`))) {
            return { status: 200, body: {} };
        }

        const eventType = payload?.header?.event_type as string | undefined;
        if (eventType === 'card.action.trigger') {
            return this.handleCardAction(payload.event ?? {}, app);
        }
        if (eventType !== 'im.message.receive_v1') {
            return { status: 200, body: {} };
        }

        const event = payload.event ?? {};
        const message = event.message ?? {};
        if (message.message_type !== 'text') return { status: 200, body: {} };
        if (event.sender?.sender_type === 'app') return { status: 200, body: {} };

        let text = '';
        try {
            text = JSON.parse(message.content ?? '{}').text ?? '';
        } catch {
            return { status: 200, body: {} };
        }
        const chatId = message.chat_id as string | undefined;
        const openId = event.sender?.sender_id?.open_id as string | undefined;
        if (!chatId || !openId || !text.trim()) return { status: 200, body: {} };

        // 两个应用彻底隔离：ops 回调只服务店铺/平台群，rider 回调只服务骑手群
        if (!this.acceptChat(app, chatId)) return { status: 200, body: {} };
        if (app === 'rider') {
            void this.riderGrab
                ?.handleText({ chatId, openId, text })
                .catch(e => Logger.error(`飞书骑手群消息处理失败 chat=${chatId}: ${e?.message ?? e}`, loggerCtx));
            return { status: 200, body: {} };
        }

        void this.command
            .handleMessage({
                chatId,
                openId,
                text,
                parentId: message.parent_id as string | undefined,
                rootId: message.root_id as string | undefined,
            })
            .catch(e => Logger.error(`飞书指令处理失败 chat=${chatId}: ${e?.message ?? e}`, loggerCtx));
        return { status: 200, body: {} };
    }

    /** 卡片按钮回调：value 里带着完整单号，直接转指令服务（先 200 再异步执行） */
    private handleCardAction(event: any, app: FeishuApp): FeishuEventResult {
        const chatId = event.context?.open_chat_id ?? event.open_chat_id;
        const openId = event.operator?.open_id ?? event.open_id;
        const messageId = event.context?.open_message_id ?? event.open_message_id;
        const value = event.action?.value;
        if (!chatId || !openId || !value) return { status: 200, body: {} };

        if (!this.acceptChat(app, chatId)) return { status: 200, body: {} };

        // 骑手应用只走抢单服务；运维应用只走商家指令服务
        if (app === 'rider') {
            void this.riderGrab
                ?.handleCardAction({ chatId, openId, value, messageId })
                .catch(e => Logger.error(`飞书骑手抢单回调失败 chat=${chatId}: ${e?.message ?? e}`, loggerCtx));
            return { status: 200, body: {} };
        }

        void this.command
            .handleCardAction({ chatId, openId, value, messageId })
            .catch(e => Logger.error(`飞书卡片操作失败 chat=${chatId}: ${e?.message ?? e}`, loggerCtx));
        return { status: 200, body: {} };
    }

    /** 按应用限定可处理的群：ops 不收骑手群事件，rider 只收骑手群事件 */
    private acceptChat(app: FeishuApp, chatId: string): boolean {
        const scope = this.cfg.chatOf(chatId)?.scope;
        if (app === 'rider') {
            if (scope !== 'rider') {
                Logger.warn(`骑手回调收到非骑手群事件 chat=${chatId}，已忽略`, loggerCtx);
                return false;
            }
            return true;
        }
        if (scope === 'rider') {
            Logger.warn(
                `运维回调收到骑手群事件 chat=${chatId}，请改由 /feishu/rider/event 处理，已忽略`,
                loggerCtx,
            );
            return false;
        }
        return true;
    }

    /** 取该应用的验签/校验令牌配置；rider 缺凭证时返回 null（降级关闭） */
    private appConfig(app: FeishuApp): { encryptKey?: string; verifyToken?: string } | null {
        const s = this.cfg.settings;
        if (app === 'rider') {
            if (!s.riderAppId || !s.riderAppSecret) return null;
            return { encryptKey: s.riderEncryptKey, verifyToken: s.riderVerifyToken };
        }
        return { encryptKey: s.encryptKey, verifyToken: s.verifyToken };
    }

    /**
     * 签名校验（H3）：仅当配置了 FEISHU_ENCRYPT_KEY 时启用（飞书只在该模式下下发签名头）。
     * 该模式下请求体是 { encrypt: base64 }，JSON.stringify 可稳定复现签名原文。
     * 未配置 Encrypt Key 时飞书不下发签名，只能依赖 verifyToken（残余风险：token 泄露即可伪造回调）。
     */
    private verifySignature(raw: any, headers: FeishuRequestHeaders | undefined, encryptKey?: string): boolean {
        if (!encryptKey) return true;
        const { timestamp, nonce, signature } = headers ?? {};
        if (!timestamp || !nonce || !signature) {
            Logger.warn(
                '已配置 FEISHU_ENCRYPT_KEY 但回调缺少签名头，拒绝（请确认飞书控制台已启用 Encrypt Key）',
                loggerCtx,
            );
            return false;
        }
        const ts = Number(timestamp);
        if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
            Logger.warn('飞书回调时间戳超出容忍窗口，拒绝', loggerCtx);
            return false;
        }
        const expected = feishuSignature(timestamp, nonce, encryptKey, JSON.stringify(raw));
        if (!signatureEquals(expected, signature)) {
            Logger.warn(`飞书回调签名校验失败 type=${raw?.header?.event_type ?? '-'}`, loggerCtx);
            return false;
        }
        return true;
    }

    private async decode(raw: any, encryptKey?: string): Promise<any | null> {
        if (!raw) return null;
        if (raw.encrypt) {
            if (!encryptKey) {
                Logger.warn('收到加密事件但该应用未配置 Encrypt Key', loggerCtx);
                return null;
            }
            return decryptFeishuPayload(raw.encrypt, encryptKey);
        }
        return raw;
    }

    /** 事件订阅与卡片回调可能各有一份验证令牌，支持用逗号并列配置 */
    private verifyTokens(raw: string | undefined): string[] {
        return String(raw ?? '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    // Bug 5 修复：Map 遍历时 delete 会跳过下一个元素，导致每次只清一半过期 key
    // 改成先收集要删的 key 数组，遍历完统一 delete
    private async isDuplicate(eventId: string): Promise<boolean> {
        if (this.dedupe) {
            return this.dedupe.seenOrMark(`feishu:event:${eventId}`, EVENT_DEDUPE_MS);
        }
        const now = Date.now();
        const expired: string[] = [];
        for (const [k, at] of this.seen) {
            if (now - at > EVENT_DEDUPE_MS) expired.push(k);
        }
        for (const k of expired) this.seen.delete(k);
        if (this.seen.has(eventId)) return true;
        this.seen.set(eventId, now);
        return false;
    }
}
