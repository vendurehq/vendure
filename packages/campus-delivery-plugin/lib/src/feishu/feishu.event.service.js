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
exports.FeishuEventService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const campus_dedupe_service_1 = require("../campus-dedupe.service");
const feishu_command_service_1 = require("./feishu.command.service");
const feishu_config_1 = require("./feishu.config");
const feishu_rider_grab_service_1 = require("./feishu-rider-grab.service");
const feishu_crypto_1 = require("./feishu.crypto");
const loggerCtx = 'Feishu';
const EVENT_DEDUPE_MS = 10 * 60000;
/** 签名时间戳容忍窗口：飞书建议 1 小时内；重放由 event_id 去重兜底 */
const SIGNATURE_TOLERANCE_SECONDS = 60 * 60;
/**
 * 飞书事件订阅入口：URL 验证（challenge）→ 可选解密 → token 校验 → event_id 去重 → 异步执行指令。
 * 先返回 200 再处理业务：飞书 3 秒超时会重试，重试叠加接单/退款很难看；真正的幂等由领域层保证。
 */
let FeishuEventService = class FeishuEventService {
    constructor(cfg, command, 
    /** M5 跨实例事件去重（飞书重试可能落到另一实例）；未注入退回进程内 Map */
    dedupe, 
    /** 骑手群抢单回调（scope='rider'）；事件层按群定位分流，绝不与商家指令共用通道 */
    riderGrab) {
        this.cfg = cfg;
        this.command = command;
        this.dedupe = dedupe;
        this.riderGrab = riderGrab;
        this.seen = new Map();
    }
    async handle(raw, headers) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        if (!this.cfg.enabled)
            return { status: 200, body: {} };
        // H3：配置 Encrypt Key 时飞书会带签名头，必须先验签再解密，避免伪造/重放回调绕过 verifyToken
        if (!this.verifySignature(raw, headers))
            return { status: 403, body: {} };
        const payload = await this.decode(raw);
        if (!payload)
            return { status: 400, body: { error: 'invalid payload' } };
        // 卡片回调的事件体有时把 token 放在 event.token，两处都取
        const token = (_d = (_b = (_a = payload === null || payload === void 0 ? void 0 : payload.header) === null || _a === void 0 ? void 0 : _a.token) !== null && _b !== void 0 ? _b : (_c = payload === null || payload === void 0 ? void 0 : payload.event) === null || _c === void 0 ? void 0 : _c.token) !== null && _d !== void 0 ? _d : payload === null || payload === void 0 ? void 0 : payload.token;
        // URL 验证是纯握手（不回显任何业务数据），先放行，避免控制台保存回调地址被 token 挡住
        if (payload === null || payload === void 0 ? void 0 : payload.challenge) {
            return { status: 200, body: { challenge: payload.challenge } };
        }
        // fail closed：未配置 verifyToken 时任何人都能伪造回调，直接拒绝
        const allowed = this.verifyTokens();
        if (!allowed.length) {
            core_1.Logger.error('未配置 FEISHU_VERIFY_TOKEN，拒绝飞书回调', loggerCtx);
            return { status: 403, body: {} };
        }
        if (typeof token !== 'string' || !allowed.includes(token)) {
            // 不打印 token 原文，只暴露事件类型与长度便于排查是哪个回调的验证令牌
            core_1.Logger.warn(`飞书回调 token 校验失败 type=${(_f = (_e = payload === null || payload === void 0 ? void 0 : payload.header) === null || _e === void 0 ? void 0 : _e.event_type) !== null && _f !== void 0 ? _f : '-'} tokenLen=${typeof token === 'string' ? token.length : 'none'}`, loggerCtx);
            return { status: 403, body: {} };
        }
        const eventId = (_g = payload === null || payload === void 0 ? void 0 : payload.header) === null || _g === void 0 ? void 0 : _g.event_id;
        if (eventId && (await this.isDuplicate(eventId))) {
            return { status: 200, body: {} };
        }
        const eventType = (_h = payload === null || payload === void 0 ? void 0 : payload.header) === null || _h === void 0 ? void 0 : _h.event_type;
        if (eventType === 'card.action.trigger') {
            return this.handleCardAction((_j = payload.event) !== null && _j !== void 0 ? _j : {});
        }
        if (eventType !== 'im.message.receive_v1') {
            return { status: 200, body: {} };
        }
        const event = (_k = payload.event) !== null && _k !== void 0 ? _k : {};
        const message = (_l = event.message) !== null && _l !== void 0 ? _l : {};
        if (message.message_type !== 'text')
            return { status: 200, body: {} };
        if (((_m = event.sender) === null || _m === void 0 ? void 0 : _m.sender_type) === 'app')
            return { status: 200, body: {} };
        let text = '';
        try {
            text = (_p = JSON.parse((_o = message.content) !== null && _o !== void 0 ? _o : '{}').text) !== null && _p !== void 0 ? _p : '';
        }
        catch (_u) {
            return { status: 200, body: {} };
        }
        const chatId = message.chat_id;
        const openId = (_r = (_q = event.sender) === null || _q === void 0 ? void 0 : _q.sender_id) === null || _r === void 0 ? void 0 : _r.open_id;
        if (!chatId || !openId || !text.trim())
            return { status: 200, body: {} };
        // 骑手群与商家/平台群彻底隔离：只走抢单回调，不进入指令服务
        if (((_s = this.cfg.chatOf(chatId)) === null || _s === void 0 ? void 0 : _s.scope) === 'rider') {
            void ((_t = this.riderGrab) === null || _t === void 0 ? void 0 : _t.handleText({ chatId, openId, text }).catch(e => { var _a; return core_1.Logger.error(`飞书骑手群消息处理失败 chat=${chatId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx); }));
            return { status: 200, body: {} };
        }
        void this.command
            .handleMessage({
            chatId,
            openId,
            text,
            parentId: message.parent_id,
            rootId: message.root_id,
        })
            .catch(e => { var _a; return core_1.Logger.error(`飞书指令处理失败 chat=${chatId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx); });
        return { status: 200, body: {} };
    }
    /** 卡片按钮回调：value 里带着完整单号，直接转指令服务（先 200 再异步执行） */
    handleCardAction(event) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const chatId = (_b = (_a = event.context) === null || _a === void 0 ? void 0 : _a.open_chat_id) !== null && _b !== void 0 ? _b : event.open_chat_id;
        const openId = (_d = (_c = event.operator) === null || _c === void 0 ? void 0 : _c.open_id) !== null && _d !== void 0 ? _d : event.open_id;
        const messageId = (_f = (_e = event.context) === null || _e === void 0 ? void 0 : _e.open_message_id) !== null && _f !== void 0 ? _f : event.open_message_id;
        const value = (_g = event.action) === null || _g === void 0 ? void 0 : _g.value;
        if (!chatId || !openId || !value)
            return { status: 200, body: {} };
        // 骑手群卡片只走抢单服务；商家群卡片仍走指令服务
        if (((_h = this.cfg.chatOf(chatId)) === null || _h === void 0 ? void 0 : _h.scope) === 'rider') {
            void ((_j = this.riderGrab) === null || _j === void 0 ? void 0 : _j.handleCardAction({ chatId, openId, value, messageId }).catch(e => { var _a; return core_1.Logger.error(`飞书骑手抢单回调失败 chat=${chatId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx); }));
            return { status: 200, body: {} };
        }
        void this.command
            .handleCardAction({ chatId, openId, value, messageId })
            .catch(e => { var _a; return core_1.Logger.error(`飞书卡片操作失败 chat=${chatId}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx); });
        return { status: 200, body: {} };
    }
    /**
     * 签名校验（H3）：仅当配置了 FEISHU_ENCRYPT_KEY 时启用（飞书只在该模式下下发签名头）。
     * 该模式下请求体是 { encrypt: base64 }，JSON.stringify 可稳定复现签名原文。
     * 未配置 Encrypt Key 时飞书不下发签名，只能依赖 verifyToken（残余风险：token 泄露即可伪造回调）。
     */
    verifySignature(raw, headers) {
        var _a, _b;
        const encryptKey = this.cfg.settings.encryptKey;
        if (!encryptKey)
            return true;
        const { timestamp, nonce, signature } = headers !== null && headers !== void 0 ? headers : {};
        if (!timestamp || !nonce || !signature) {
            core_1.Logger.warn('已配置 FEISHU_ENCRYPT_KEY 但回调缺少签名头，拒绝（请确认飞书控制台已启用 Encrypt Key）', loggerCtx);
            return false;
        }
        const ts = Number(timestamp);
        if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) {
            core_1.Logger.warn('飞书回调时间戳超出容忍窗口，拒绝', loggerCtx);
            return false;
        }
        const expected = (0, feishu_crypto_1.feishuSignature)(timestamp, nonce, encryptKey, JSON.stringify(raw));
        if (!(0, feishu_crypto_1.signatureEquals)(expected, signature)) {
            core_1.Logger.warn(`飞书回调签名校验失败 type=${(_b = (_a = raw === null || raw === void 0 ? void 0 : raw.header) === null || _a === void 0 ? void 0 : _a.event_type) !== null && _b !== void 0 ? _b : '-'}`, loggerCtx);
            return false;
        }
        return true;
    }
    async decode(raw) {
        if (!raw)
            return null;
        if (raw.encrypt) {
            const key = this.cfg.settings.encryptKey;
            if (!key) {
                core_1.Logger.warn('收到加密事件但未配置 FEISHU_ENCRYPT_KEY', loggerCtx);
                return null;
            }
            return (0, feishu_crypto_1.decryptFeishuPayload)(raw.encrypt, key);
        }
        return raw;
    }
    /** 事件订阅与卡片回调可能各有一份验证令牌，支持用逗号并列配置 */
    verifyTokens() {
        var _a;
        return String((_a = this.cfg.settings.verifyToken) !== null && _a !== void 0 ? _a : '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }
    // Bug 5 修复：Map 遍历时 delete 会跳过下一个元素，导致每次只清一半过期 key
    // 改成先收集要删的 key 数组，遍历完统一 delete
    async isDuplicate(eventId) {
        if (this.dedupe) {
            return this.dedupe.seenOrMark(`feishu:event:${eventId}`, EVENT_DEDUPE_MS);
        }
        const now = Date.now();
        const expired = [];
        for (const [k, at] of this.seen) {
            if (now - at > EVENT_DEDUPE_MS)
                expired.push(k);
        }
        for (const k of expired)
            this.seen.delete(k);
        if (this.seen.has(eventId))
            return true;
        this.seen.set(eventId, now);
        return false;
    }
};
exports.FeishuEventService = FeishuEventService;
exports.FeishuEventService = FeishuEventService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [feishu_config_1.FeishuConfigService,
        feishu_command_service_1.FeishuCommandService,
        campus_dedupe_service_1.CampusDedupeService,
        feishu_rider_grab_service_1.FeishuRiderGrabService])
], FeishuEventService);
//# sourceMappingURL=feishu.event.service.js.map