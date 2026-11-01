"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeishuClient = void 0;
exports.buildWebhookSignature = buildWebhookSignature;
exports.buildWebhookPayload = buildWebhookPayload;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const crypto_1 = require("crypto");
const feishu_config_1 = require("./feishu.config");
const loggerCtx = 'Feishu';
const API_BASE = 'https://open.feishu.cn/open-apis';
// Bug 4 修复：生产 PATCH updateCard / listMessages 翻页 8-10s 常见，5s 太严导致频繁超时
const HTTP_TIMEOUT_MS = 10000;
/** 自定义群机器人签名：base64(hmac_sha256(key = `${timestamp}\n${secret}`, data = '')) */
function buildWebhookSignature(timestamp, secret) {
    return (0, crypto_1.createHmac)('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}
function buildWebhookPayload(text, secret, now = Date.now()) {
    const payload = { msg_type: 'text', content: { text } };
    if (secret) {
        const timestamp = String(Math.floor(now / 1000));
        payload.timestamp = timestamp;
        payload.sign = buildWebhookSignature(timestamp, secret);
    }
    return payload;
}
async function postJson(url, body, timeoutMs = HTTP_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null);
        return res.ok ? json : Object.assign({ __httpStatus: res.status }, (json !== null && json !== void 0 ? json : {}));
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 飞书发送通道：
 * - 群自定义机器人 webhook（只能发，最简单，用于运维群推送）
 * - 自建应用 bot（tenant_access_token，可定向回复任意已加入的群）
 * 失败只记日志并返回 false，绝不抛到订单主流程。
 */
let FeishuClient = class FeishuClient {
    constructor(cfg) {
        this.cfg = cfg;
    }
    get enabled() {
        return this.cfg.enabled;
    }
    /** 推送到群自定义机器人（or 单群 webhook）；reasonOut（§119）回填失败原因，供后台展示 */
    async sendWebhook(text, reasonOut) {
        var _a, _b, _c, _d, _e;
        const { webhook, secret } = this.cfg.settings;
        if (!webhook) {
            if (reasonOut)
                reasonOut.reason = '未配置 webhook';
            return false;
        }
        try {
            const json = await postJson(webhook, buildWebhookPayload(text, secret));
            const code = (_a = json === null || json === void 0 ? void 0 : json.code) !== null && _a !== void 0 ? _a : json === null || json === void 0 ? void 0 : json.StatusCode;
            if (json && (code === 0 || code === undefined) && !json.__httpStatus)
                return true;
            const reason = (json === null || json === void 0 ? void 0 : json.__httpStatus)
                ? `webhook HTTP ${json.__httpStatus}`
                : `code=${code !== null && code !== void 0 ? code : 'n/a'} msg=${(_c = (_b = json === null || json === void 0 ? void 0 : json.msg) !== null && _b !== void 0 ? _b : json === null || json === void 0 ? void 0 : json.StatusMessage) !== null && _c !== void 0 ? _c : 'n/a'}`;
            core_1.Logger.warn(`飞书 webhook 发送失败：${reason}`, loggerCtx);
            if (reasonOut)
                reasonOut.reason = `webhook ${reason}`;
            return false;
        }
        catch (e) {
            core_1.Logger.warn(`飞书 webhook 发送异常：${(_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e}`, loggerCtx);
            if (reasonOut)
                reasonOut.reason = `webhook 异常：${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`;
            return false;
        }
    }
    /** 以自建应用身份发到指定群；未配置应用时退回 webhook */
    async sendToChat(chatId, text, opts) {
        const { appId, appSecret } = this.cfg.settings;
        if (!appId || !appSecret)
            return this.sendWebhook(text, opts === null || opts === void 0 ? void 0 : opts.reasonOut);
        const content = { text };
        if (opts === null || opts === void 0 ? void 0 : opts.atAll) {
            content.text = `<at user_id="all">所有人</at> ${text}`;
        }
        return (await this.sendMessage(chatId, 'text', content, opts === null || opts === void 0 ? void 0 : opts.reasonOut)) != null;
    }
    /** 发交互卡片，返回 message_id（失败 null；调用方自行降级） */
    async sendCard(chatId, card) {
        return this.sendMessage(chatId, 'interactive', card);
    }
    /** 更新已发送的卡片（局部刷新，不刷屏） */
    async updateCard(messageId, card) {
        if (!this.cfg.settings.appId)
            return false;
        const json = await this.request('PATCH', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}`, {
            content: JSON.stringify(card),
        });
        return this.ok(json);
    }
    /** 线程内回复（reply_in_thread=true 时落进该消息所在话题） */
    async replyToMessage(messageId, text, inThread = true) {
        if (!this.cfg.settings.appId)
            return false;
        const json = await this.request('POST', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
            msg_type: 'text',
            content: JSON.stringify({ text }),
            reply_in_thread: inThread,
        });
        return this.ok(json);
    }
    /** 线程内回卡片（快捷回复面板落进订单话题，不另起话题） */
    async replyCard(messageId, card, inThread = true) {
        if (!this.cfg.settings.appId)
            return false;
        const json = await this.request('POST', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
            msg_type: 'interactive',
            content: JSON.stringify(card),
            reply_in_thread: inThread,
        });
        return this.ok(json);
    }
    /** 回读单条消息（用于引用回复解析卡片里的单号） */
    async getMessage(messageId) {
        var _a, _b, _c;
        if (!this.cfg.settings.appId)
            return null;
        const json = await this.request('GET', `${API_BASE}/im/v1/messages/${encodeURIComponent(messageId)}`);
        if (!this.ok(json))
            return null;
        return ((_c = (_b = (_a = json === null || json === void 0 ? void 0 : json.data) === null || _a === void 0 ? void 0 : _a.items) === null || _b === void 0 ? void 0 : _b[0]) !== null && _c !== void 0 ? _c : null);
    }
    /** 读取群消息（新→旧），用于日报去重与话题聚合，不落库 */
    async listMessages(chatId, startSec, endSec, pageToken) {
        var _a, _b, _c;
        if (!this.cfg.settings.appId)
            return { items: [] };
        const qs = [
            'container_id_type=chat',
            `container_id=${encodeURIComponent(chatId)}`,
            `start_time=${Math.floor(startSec)}`,
            `end_time=${Math.floor(endSec)}`,
            'sort_type=ByCreateTimeDesc',
            'page_size=50',
        ];
        if (pageToken)
            qs.push(`page_token=${encodeURIComponent(pageToken)}`);
        const json = await this.request('GET', `${API_BASE}/im/v1/messages?${qs.join('&')}`);
        if (!this.ok(json))
            return { items: [] };
        return {
            items: ((_b = (_a = json === null || json === void 0 ? void 0 : json.data) === null || _a === void 0 ? void 0 : _a.items) !== null && _b !== void 0 ? _b : []),
            nextToken: ((_c = json === null || json === void 0 ? void 0 : json.data) === null || _c === void 0 ? void 0 : _c.page_token) || undefined,
        };
    }
    /** 广播卡片：逐个已映射群发送 */
    async broadcastCard(card) {
        if (!this.enabled)
            return false;
        const chats = Object.keys(this.cfg.settings.chats);
        let ok = false;
        for (const chatId of chats) {
            if (await this.sendCard(chatId, card))
                ok = true;
        }
        return ok;
    }
    async sendMessage(chatId, msgType, content, reasonOut) {
        var _a, _b, _c, _d;
        const { appId, appSecret } = this.cfg.settings;
        if (!appId || !appSecret) {
            if (reasonOut)
                reasonOut.reason = '未配置飞书应用';
            return null;
        }
        const json = await this.request('POST', `${API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
            receive_id: chatId,
            msg_type: msgType,
            content: JSON.stringify(content),
        });
        if (!this.ok(json)) {
            const reason = json
                ? `code=${(_a = json === null || json === void 0 ? void 0 : json.code) !== null && _a !== void 0 ? _a : 'n/a'} msg=${(_b = json === null || json === void 0 ? void 0 : json.msg) !== null && _b !== void 0 ? _b : 'n/a'}${(json === null || json === void 0 ? void 0 : json.__httpStatus) ? ` http=${json.__httpStatus}` : ''}`
                : '请求失败（无法获取 access_token）';
            core_1.Logger.warn(`飞书消息发送失败：${reason}`, loggerCtx);
            if (reasonOut)
                reasonOut.reason = reason;
            return null;
        }
        return (_d = (_c = json === null || json === void 0 ? void 0 : json.data) === null || _c === void 0 ? void 0 : _c.message_id) !== null && _d !== void 0 ? _d : null;
    }
    // Bug 8 修复：严格只认飞书返回 code=0 为成功；undefined/空对象/未知错误码一律当失败
    // 之前把 code===undefined 也当成功，网络异常返回 {} 空对象时会误判为成功→以为卡片发出去了实际没发
    ok(json) {
        return !!json && !json.__httpStatus && json.code === 0;
    }
    async request(method, url, body) {
        var _a;
        const token = await this.tenantToken();
        if (!token)
            return null;
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
            const json = await res.json().catch(() => null);
            return res.ok ? json : Object.assign({ __httpStatus: res.status }, (json !== null && json !== void 0 ? json : {}));
        }
        catch (e) {
            core_1.Logger.warn(`飞书 ${method} 请求异常：${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** 按订单渠道解析接收群：本店群 + 平台群。未传渠道时返回全部（仅限平台级广播使用）。 */
    chatIdsFor(channelToken) {
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
    async broadcast(text, opts) {
        if (!this.enabled) {
            if (opts === null || opts === void 0 ? void 0 : opts.reasonOut)
                opts.reasonOut.reason = '推送渠道未配置';
            return false;
        }
        const chats = Object.entries(this.cfg.settings.chats);
        if (chats.length === 0)
            return this.sendWebhook(text, opts === null || opts === void 0 ? void 0 : opts.reasonOut);
        let ok = false;
        let matched = false;
        for (const [chatId, chat] of chats) {
            // scope=platform 只发跨店平台群；未指定则全发
            if ((opts === null || opts === void 0 ? void 0 : opts.scope) && chat.scope !== opts.scope)
                continue;
            if ((opts === null || opts === void 0 ? void 0 : opts.channel) && chat.scope !== 'platform' && chat.channel !== opts.channel)
                continue;
            matched = true;
            if (await this.sendToChat(chatId, text, opts))
                ok = true;
        }
        if (!matched)
            return this.sendWebhook(text, opts === null || opts === void 0 ? void 0 : opts.reasonOut);
        if (!ok && (opts === null || opts === void 0 ? void 0 : opts.reasonOut) && !opts.reasonOut.reason)
            opts.reasonOut.reason = '已映射群均发送失败';
        return ok;
    }
    /** tenant_access_token 缓存（提前 5 分钟过期），单飞防并发重复取 */
    async tenantToken() {
        const { appId, appSecret } = this.cfg.settings;
        if (!appId || !appSecret)
            return null;
        const now = Date.now();
        if (this.token && this.token.expiresAt > now)
            return this.token.value;
        if (this.inflight)
            return this.inflight;
        this.inflight = (async () => {
            var _a, _b, _c, _d;
            try {
                const json = await postJson(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
                    app_id: appId,
                    app_secret: appSecret,
                });
                if (!(json === null || json === void 0 ? void 0 : json.tenant_access_token)) {
                    core_1.Logger.warn(`获取 tenant_access_token 失败：code=${(_a = json === null || json === void 0 ? void 0 : json.code) !== null && _a !== void 0 ? _a : 'n/a'} msg=${(_b = json === null || json === void 0 ? void 0 : json.msg) !== null && _b !== void 0 ? _b : 'n/a'}`, loggerCtx);
                    return null;
                }
                const ttl = Number((_c = json.expire) !== null && _c !== void 0 ? _c : 7200) * 1000;
                this.token = { value: json.tenant_access_token, expiresAt: now + ttl - 5 * 60000 };
                return json.tenant_access_token;
            }
            catch (e) {
                core_1.Logger.warn(`获取 tenant_access_token 异常：${(_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : e}`, loggerCtx);
                return null;
            }
            finally {
                this.inflight = undefined;
            }
        })();
        return this.inflight;
    }
};
exports.FeishuClient = FeishuClient;
exports.FeishuClient = FeishuClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [feishu_config_1.FeishuConfigService])
], FeishuClient);
//# sourceMappingURL=feishu.client.js.map