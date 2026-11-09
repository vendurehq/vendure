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
exports.FeishuConfigService = void 0;
exports.parseChatMap = parseChatMap;
exports.readFeishuSettings = readFeishuSettings;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const loggerCtx = 'Feishu';
function splitIds(v) {
    return (v !== null && v !== void 0 ? v : '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}
/** 解析 FEISHU_CHAT_MAP（坏 JSON 只告警并退回空表，绝不抛错） */
function parseChatMap(raw) {
    if (!raw || !raw.trim())
        return {};
    try {
        const parsed = JSON.parse(raw);
        const out = {};
        for (const [chatId, v] of Object.entries(parsed !== null && parsed !== void 0 ? parsed : {})) {
            const item = v;
            if (!item)
                continue;
            // 平台群只能由 scope='platform' 显式声明；channel='*' 属于历史写法，直接忽略并告警，
            // 避免配置里多打一个字符就静默获得全店写权限。
            if (item.channel === '*') {
                core_1.Logger.warn(`FEISHU_CHAT_MAP 群 ${chatId} 使用了已废弃的 channel:'*'，已忽略；平台群请改用 scope:'platform'`, loggerCtx);
                continue;
            }
            const platform = item.scope === 'platform';
            const rider = item.scope === 'rider';
            const channel = typeof item.channel === 'string' ? item.channel : undefined;
            // 骑手群不需要渠道绑定；其余群必须显式 platform 或 channel
            if (!platform && !rider && !channel)
                continue;
            out[chatId] = {
                scope: rider ? 'rider' : platform ? 'platform' : 'channel',
                channel: rider ? undefined : channel,
                operators: Array.isArray(item.operators)
                    ? item.operators.map(String)
                    : splitIds(item.operators),
                owners: Array.isArray(item.owners) ? item.owners.map(String) : splitIds(item.owners),
            };
        }
        return out;
    }
    catch (e) {
        core_1.Logger.error(`FEISHU_CHAT_MAP 解析失败，指令功能将不可用：${e === null || e === void 0 ? void 0 : e.message}`, loggerCtx);
        return {};
    }
}
function readFeishuSettings(env = process.env) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const enabled = String((_a = env.FEISHU_ENABLED) !== null && _a !== void 0 ? _a : '').toLowerCase() === 'true'
        || String((_b = env.FEISHU_ENABLED) !== null && _b !== void 0 ? _b : '') === '1';
    const settings = {
        enabled,
        webhook: ((_c = env.FEISHU_WEBHOOK) === null || _c === void 0 ? void 0 : _c.trim()) || undefined,
        secret: ((_d = env.FEISHU_SECRET) === null || _d === void 0 ? void 0 : _d.trim()) || undefined,
        appId: ((_e = env.FEISHU_APP_ID) === null || _e === void 0 ? void 0 : _e.trim()) || undefined,
        appSecret: ((_f = env.FEISHU_APP_SECRET) === null || _f === void 0 ? void 0 : _f.trim()) || undefined,
        verifyToken: ((_g = env.FEISHU_VERIFY_TOKEN) === null || _g === void 0 ? void 0 : _g.trim()) || undefined,
        encryptKey: ((_h = env.FEISHU_ENCRYPT_KEY) === null || _h === void 0 ? void 0 : _h.trim()) || undefined,
        riderAppId: ((_j = env.FEISHU_RIDER_APP_ID) === null || _j === void 0 ? void 0 : _j.trim()) || undefined,
        riderAppSecret: ((_k = env.FEISHU_RIDER_APP_SECRET) === null || _k === void 0 ? void 0 : _k.trim()) || undefined,
        riderVerifyToken: ((_l = env.FEISHU_RIDER_VERIFY_TOKEN) === null || _l === void 0 ? void 0 : _l.trim()) || undefined,
        riderEncryptKey: ((_m = env.FEISHU_RIDER_ENCRYPT_KEY) === null || _m === void 0 ? void 0 : _m.trim()) || undefined,
        chats: parseChatMap(env.FEISHU_CHAT_MAP),
        digestAt: /^\d{2}:\d{2}$/.test((_o = env.FEISHU_DIGEST_AT) !== null && _o !== void 0 ? _o : '') ? String(env.FEISHU_DIGEST_AT) : '08:30',
    };
    if (!enabled)
        return settings;
    const hasSend = !!(settings.webhook || (settings.appId && settings.appSecret));
    const hasReceive = !!(settings.appId && settings.appSecret && settings.verifyToken);
    if (!hasSend && !hasReceive) {
        core_1.Logger.error('FEISHU_ENABLED=true 但未配置发送通道（FEISHU_WEBHOOK 或 FEISHU_APP_ID/SECRET），飞书功能禁用', loggerCtx);
        settings.enabled = false;
    }
    else if (!hasSend) {
        core_1.Logger.warn('飞书接收通道已配置但缺发送通道，推送与回复将不可用', loggerCtx);
    }
    return settings;
}
let FeishuConfigService = class FeishuConfigService {
    constructor() {
        this.settings = readFeishuSettings(process.env);
        if (this.settings.enabled) {
            const mode = this.settings.webhook ? 'webhook' : 'app';
            core_1.Logger.info(`飞书已启用（${mode}，群数 ${Object.keys(this.settings.chats).length}）`, loggerCtx);
            // 骑手抢单为独立应用：缺凭证只降级关闭抢单，绝不影响运维告警与店铺指令
            if (!this.riderAppConfigured) {
                core_1.Logger.warn('未配置骑手飞书应用（FEISHU_RIDER_APP_ID / FEISHU_RIDER_APP_SECRET），骑手抢单已降级关闭；运维告警不受影响', loggerCtx);
            }
            else {
                if (!this.settings.riderVerifyToken) {
                    core_1.Logger.warn('骑手飞书应用缺少 FEISHU_RIDER_VERIFY_TOKEN，抢单卡片点击回调将不可用', loggerCtx);
                }
                if (!this.settings.riderEncryptKey) {
                    // 未配置 Encrypt Key 时飞书不下发签名头，只能依赖 verifyToken；仅提示不阻断
                    core_1.Logger.info('骑手飞书应用未配置 FEISHU_RIDER_ENCRYPT_KEY，回调仅依赖 verifyToken 校验', loggerCtx);
                }
            }
            // 骑手群 chat_id 允许后填：缺失只告警，不影响启动与其他群指令
            if (!this.riderChatIds.length) {
                core_1.Logger.warn('未配置骑手群（FEISHU_CHAT_MAP 中 scope:"rider"），抢单卡片不启用', loggerCtx);
            }
        }
    }
    get enabled() {
        return this.settings.enabled;
    }
    /** 骑手应用是否具备发送能力（缺任一项即视为未配置） */
    get riderAppConfigured() {
        return !!(this.settings.riderAppId && this.settings.riderAppSecret);
    }
    /** 骑手群 chat_id 列表（scope='rider'）；未配置返回空数组，调用方只告警不抛错 */
    get riderChatIds() {
        return Object.entries(this.settings.chats)
            .filter(([, v]) => v.scope === 'rider')
            .map(([chatId]) => chatId);
    }
    chatOf(chatId) {
        return this.settings.chats[chatId];
    }
};
exports.FeishuConfigService = FeishuConfigService;
exports.FeishuConfigService = FeishuConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], FeishuConfigService);
//# sourceMappingURL=feishu.config.js.map