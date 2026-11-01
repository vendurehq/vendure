import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import { createHmac } from 'crypto';

import { FeishuConfigService } from './feishu.config';

const loggerCtx = 'Feishu';
const API_BASE = 'https://open.feishu.cn/open-apis';
// Bug 4 修复：生产 PATCH updateCard / listMessages 翻页 8-10s 常见，5s 太严导致频繁超时
const HTTP_TIMEOUT_MS = 10_000;

/** 飞书消息体（只取用到的字段） */
export interface FeishuMessage {
    message_id: string;
    msg_type?: string;
    create_time?: string;
    parent_id?: string;
    root_id?: string;
    body?: { content?: string };
    thread_id?: string;
}

/** 自定义群机器人签名：base64(hmac_sha256(key = `${timestamp}\n${secret}`, data = '')) */
export function buildWebhookSignature(timestamp: string, secret: string): string {
    return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

export function buildWebhookPayload(text: string, secret?: string, now = Date.now()): Record<string, unknown> {
    const payload: Record<string, unknown> = { msg_type: 'text', content: { text } };
    if (secret) {
        const timestamp = String(Math.floor(now / 1000));
        payload.timestamp = timestamp;
        payload.sign = buildWebhookSignature(timestamp, secret);
    }
    return payload;
}

async function postJson(url: string, body: unknown, timeoutMs = HTTP_TIMEOUT_MS): Promise<any | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const json: any = await res.json().catch(() => null);
        return res.ok ? json : { __httpStatus: res.status, ...(json ?? {}) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 飞书发送通道：
 * - 群自定义机器人 webhook（只能发，最简单，用于运维群推送）
 * - 自建应用 bot（tenant_access_token，可定向回复任意已加入的群）
 * 失败只记日志并返回 false，绝不抛到订单主流程。
 */
@Injectable()
export class FeishuClient {
    private token?: { value: string; expiresAt: number };
    private inflight?: Promise<string | null>;

    constructor(private cfg: FeishuConfigService) {}

    get enabled(): boolean {
        return this.cfg.enabled;
    }

    /** 推送到群自定义机器人（or 单群 webhook）；reasonOut（§119）回填失败原因，供后台展示 */
    async sendWebhook(text: string, reasonOut?: { reason: string }): Promise<boolean> {
        const { webhook, secret } = this.cfg.settings;
        if (!webhook) {
            if (reasonOut) reasonOut.reason = '未配置 webhook';
            return false;
        }
        try {
            const json = await postJson(webhook, buildWebhookPayload(text, secret));
            const code = json?.code ?? json?.StatusCode;
            if (json && (code === 0 || code === undefined) && !json.__httpStatus) return true;
            const reason = json?.__httpStatus
                ? `webhook HTTP ${json.__httpStatus}`
                : `code=${code ?? 'n/a'} msg=${json?.msg ?? json?.StatusMessage ?? 'n/a'}`;
            Logger.warn(`飞书 webhook 发送失败：${reason}`, loggerCtx);
            if (reasonOut) reasonOut.reason = `webhook ${reason}`;
            return false;
        } catch (e: any) {
            Logger.warn(`飞书 webhook 发送异常：${e?.message ?? e}`, loggerCtx);
            if (reasonOut) reasonOut.reason = `webhook 异常：${e?.message ?? e}`;
            return false;
        }
    }

    /** 以自建应用身份发到指定群；未配置应用时退回 webhook */
    async sendToChat(chatId: string, text: string, opts?: { atAll?: boolean; reasonOut?: { reason: string } }): Promise<boolean> {
        const { appId, appSecret } = this.cfg.settings;
        if (!appId || !appSecret) return this.sendWebhook(text, opts?.reasonOut);
        const content: any = { text };
        if (opts?.atAll) {
            content.text = `<at user_id="all">所有人</at> ${text}`;
        }
        return (await this.sendMessage(chatId, 'text', content, opts?.reasonOut)) != null;
    }

    /** 发交互卡片，返回 message_id（失败 null；调用方自行降级） */
    async sendCard(chatId: string, card: unknown): Promise<string | null> {
        return this.sendMessage(chatId, 'interactive', card);
    }

    /** 更新已发送的卡片（局部刷新，不刷屏） */
    async updateCard(messageId: string, card: unknown): Promise<boolean> {
        if (!this.cfg.settings.appId) return false;
        const json = await this.request('PATCH', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}`, {
            content: JSON.stringify(card),
        });
        return this.ok(json);
    }

    /** 线程内回复（reply_in_thread=true 时落进该消息所在话题） */
    async replyToMessage(messageId: string, text: string, inThread = true): Promise<boolean> {
        if (!this.cfg.settings.appId) return false;
        const json = await this.request('POST', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
            msg_type: 'text',
            content: JSON.stringify({ text }),
            reply_in_thread: inThread,
        });
        return this.ok(json);
    }

    /** 线程内回卡片（快捷回复面板落进订单话题，不另起话题） */
    async replyCard(messageId: string, card: unknown, inThread = true): Promise<boolean> {
        if (!this.cfg.settings.appId) return false;
        const json = await this.request('POST', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
            msg_type: 'interactive',
            content: JSON.stringify(card),
            reply_in_thread: inThread,
        });
        return this.ok(json);
    }

    /** 回读单条消息（用于引用回复解析卡片里的单号） */
    async getMessage(messageId: string): Promise<FeishuMessage | null> {
        if (!this.cfg.settings.appId) return null;
        const json = await this.request('GET', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}`);
        if (!this.ok(json)) return null;
        return (json?.data?.items?.[0] ?? null) as FeishuMessage | null;
    }

    /** 读取群消息（新→旧），用于日报去重与话题聚合，不落库 */
    async listMessages(
        chatId: string,
        startSec: number,
        endSec: number,
        pageToken?: string,
    ): Promise<{ items: FeishuMessage[]; nextToken?: string }> {
        if (!this.cfg.settings.appId) return { items: [] };
        const qs = [
            'container_id_type=chat',
            `container_id=${encodeURIComponent(chatId)}`,
            `start_time=${Math.floor(startSec)}`,
            `end_time=${Math.floor(endSec)}`,
            'sort_type=ByCreateTimeDesc',
            'page_size=50',
        ];
        if (pageToken) qs.push(`page_token=${encodeURIComponent(pageToken)}`);
        const json = await this.request('GET', `${API_BASE}/im/v1/messages?${qs.join('&')}`);
        if (!this.ok(json)) return { items: [] };
        return {
            items: (json?.data?.items ?? []) as FeishuMessage[],
            nextToken: json?.data?.page_token || undefined,
        };
    }

    /** 广播卡片：逐个已映射群发送 */
    async broadcastCard(card: unknown): Promise<boolean> {
        if (!this.enabled) return false;
        const chats = Object.keys(this.cfg.settings.chats);
        let ok = false;
        for (const chatId of chats) {
            if (await this.sendCard(chatId, card)) ok = true;
        }
        return ok;
    }

    private async sendMessage(
        chatId: string,
        msgType: string,
        content: unknown,
        reasonOut?: { reason: string },
    ): Promise<string | null> {
        const { appId, appSecret } = this.cfg.settings;
        if (!appId || !appSecret) {
            if (reasonOut) reasonOut.reason = '未配置飞书应用';
            return null;
        }
        const json = await this.request('POST', `${API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
            receive_id: chatId,
            msg_type: msgType,
            content: JSON.stringify(content),
        });
        if (!this.ok(json)) {
            const reason = json
                ? `code=${json?.code ?? 'n/a'} msg=${json?.msg ?? 'n/a'}${json?.__httpStatus ? ` http=${json.__httpStatus}` : ''}`
                : '请求失败（无法获取 access_token）';
            Logger.warn(
                `飞书消息发送失败：${reason}`,
                loggerCtx,
            );
            if (reasonOut) reasonOut.reason = reason;
            return null;
        }
        return json?.data?.message_id ?? null;
    }

    // Bug 8 修复：严格只认飞书返回 code=0 为成功；undefined/空对象/未知错误码一律当失败
    // 之前把 code===undefined 也当成功，网络异常返回 {} 空对象时会误判为成功→以为卡片发出去了实际没发
    private ok(json: any): boolean {
        return !!json && !json.__httpStatus && json.code === 0;
    }

    private async request(method: string, url: string, body?: unknown): Promise<any | null> {
        const token = await this.tenantToken();
        if (!token) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Authorization: `Bearer ${token}`,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: ctrl.signal,
            });
            const json: any = await res.json().catch(() => null);
            return res.ok ? json : { __httpStatus: res.status, ...(json ?? {}) };
        } catch (e: any) {
            Logger.warn(`飞书 ${method} 请求异常：${e?.message ?? e}`, loggerCtx);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /** 按订单渠道解析接收群：本店群 + 平台群。未传渠道时返回全部（仅限平台级广播使用）。 */
    chatIdsFor(channelToken?: string): string[] {
        return Object.entries(this.cfg.settings.chats)
            .filter(([, chat]) => !channelToken || chat.scope === 'platform' || chat.channel === channelToken)
            .map(([chatId]) => chatId);
    }

    /**
     * 广播：优先发到已映射群；没有群映射时退回 webhook。
     * - scope：只发指定范围（platform = 跨店平台群）
     * - channel：店铺定向推送 —— 只发「该店铺群 + 平台群」，避免 A 店告警刷到 B 店群；
     *   若没有任何群命中（例如未配置店铺群）则退回 webhook，保证告警不静默丢失。
     */
    async broadcast(
        text: string,
        opts?: { atAll?: boolean; scope?: string; channel?: string; reasonOut?: { reason: string } },
    ): Promise<boolean> {
        if (!this.enabled) {
            if (opts?.reasonOut) opts.reasonOut.reason = '推送渠道未配置';
            return false;
        }
        const chats = Object.entries(this.cfg.settings.chats);
        if (chats.length === 0) return this.sendWebhook(text, opts?.reasonOut);
        let ok = false;
        let matched = false;
        for (const [chatId, chat] of chats) {
            // scope=platform 只发跨店平台群；未指定则全发
            if (opts?.scope && chat.scope !== opts.scope) continue;
            if (opts?.channel && chat.scope !== 'platform' && chat.channel !== opts.channel) continue;
            matched = true;
            if (await this.sendToChat(chatId, text, opts)) ok = true;
        }
        if (!matched) return this.sendWebhook(text, opts?.reasonOut);
        if (!ok && opts?.reasonOut && !opts.reasonOut.reason) opts.reasonOut.reason = '已映射群均发送失败';
        return ok;
    }

    /** tenant_access_token 缓存（提前 5 分钟过期），单飞防并发重复取 */
    private async tenantToken(): Promise<string | null> {
        const { appId, appSecret } = this.cfg.settings;
        if (!appId || !appSecret) return null;
        const now = Date.now();
        if (this.token && this.token.expiresAt > now) return this.token.value;
        if (this.inflight) return this.inflight;
        this.inflight = (async () => {
            try {
                const json = await postJson(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
                    app_id: appId,
                    app_secret: appSecret,
                });
                if (!json?.tenant_access_token) {
                    Logger.warn(`获取 tenant_access_token 失败：code=${json?.code ?? 'n/a'} msg=${json?.msg ?? 'n/a'}`, loggerCtx);
                    return null;
                }
                const ttl = Number(json.expire ?? 7200) * 1000;
                this.token = { value: json.tenant_access_token, expiresAt: now + ttl - 5 * 60_000 };
                return json.tenant_access_token;
            } catch (e: any) {
                Logger.warn(`获取 tenant_access_token 异常：${e?.message ?? e}`, loggerCtx);
                return null;
            } finally {
                this.inflight = undefined;
            }
        })();
        return this.inflight;
    }
}
