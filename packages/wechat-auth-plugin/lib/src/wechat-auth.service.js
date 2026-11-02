"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatAuthService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const crypto = __importStar(require("crypto"));
const constants_1 = require("./constants");
const constants_2 = require("./constants");
/** 微信出站 API 超时：登录/取 token 必须快速失败，避免请求挂死拖住线程 */
const WECHAT_HTTP_TIMEOUT_MS = 5000;
let WechatAuthService = class WechatAuthService {
    constructor(options) {
        this.options = options;
        this.accessTokenCache = null;
        this.miniProgramTokenCacheMap = new Map();
        this.miniProgramTokenPromiseMap = new Map();
        this.ticketCache = null;
        this.accessTokenPromise = null;
        this.ticketPromise = null;
        this.REFRESH_BUFFER_SECONDS = 300; // Refresh 5 minutes before expiry
    }
    async getAccessToken() {
        if (this.accessTokenCache && Date.now() < this.accessTokenCache.expiresAt) {
            return this.accessTokenCache.token;
        }
        if (this.accessTokenPromise)
            return this.accessTokenPromise;
        this.accessTokenPromise = this.fetchAccessToken().finally(() => {
            this.accessTokenPromise = null;
        });
        return this.accessTokenPromise;
    }
    async getJsapiTicket() {
        if (this.ticketCache && Date.now() < this.ticketCache.expiresAt) {
            return this.ticketCache.token;
        }
        if (this.ticketPromise)
            return this.ticketPromise;
        this.ticketPromise = this.fetchJsapiTicket().finally(() => {
            this.ticketPromise = null;
        });
        return this.ticketPromise;
    }
    async getMiniProgramAccessToken(appId, appSecret) {
        const cached = this.miniProgramTokenCacheMap.get(appId);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.token;
        }
        // 并发去重
        const existing = this.miniProgramTokenPromiseMap.get(appId);
        if (existing)
            return existing;
        const promise = this.fetchAccessTokenByCredentials(appId, appSecret).finally(() => {
            this.miniProgramTokenPromiseMap.delete(appId);
        });
        this.miniProgramTokenPromiseMap.set(appId, promise);
        return promise;
    }
    async fetchAccessTokenByCredentials(appId, appSecret) {
        const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS) });
        const data = (await response.json());
        if (data.access_token) {
            this.miniProgramTokenCacheMap.set(appId, {
                token: data.access_token,
                expiresAt: Date.now() + (data.expires_in - this.REFRESH_BUFFER_SECONDS) * 1000,
            });
            core_1.Logger.info(`MiniProgram access_token refreshed for appId=${appId}, expires in ${data.expires_in}s`, constants_2.loggerCtx);
            return data.access_token;
        }
        core_1.Logger.error(`Failed to get MiniProgram access_token: ${JSON.stringify(data)}`, constants_2.loggerCtx);
        throw new Error('Failed to get WeChat MiniProgram access_token');
    }
    async generateJsapiSignature(url) {
        const ticket = await this.getJsapiTicket();
        const timestamp = Math.floor(Date.now() / 1000);
        const nonceStr = this.generateNonceStr();
        const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
        const signature = crypto.createHash('sha1').update(raw).digest('hex');
        return {
            appId: this.options.appId,
            timestamp,
            nonceStr,
            signature,
        };
    }
    async fetchAccessToken() {
        return this.fetchAccessTokenByCredentials(this.options.appId, this.options.appSecret);
    }
    /** 按凭证取 access_token：未传或与插件主 appId 相同时走主缓存；否则按 appId 独立缓存 */
    async getAccessTokenFor(cred) {
        if (!(cred === null || cred === void 0 ? void 0 : cred.appId) || !cred.appSecret || cred.appId === this.options.appId) {
            return this.getAccessToken();
        }
        return this.getMiniProgramAccessToken(cred.appId, cred.appSecret);
    }
    async fetchJsapiTicket() {
        const accessToken = await this.getAccessToken();
        const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${accessToken}&type=jsapi`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS) });
        const data = (await response.json());
        if (data.ticket) {
            this.ticketCache = {
                token: data.ticket,
                expiresAt: Date.now() + (data.expires_in - this.REFRESH_BUFFER_SECONDS) * 1000,
            };
            core_1.Logger.info(`WeChat jsapi_ticket refreshed, expires in ${data.expires_in}s`, constants_2.loggerCtx);
            return data.ticket;
        }
        core_1.Logger.error(`Failed to get jsapi_ticket: ${JSON.stringify(data)}`, constants_2.loggerCtx);
        throw new Error('Failed to get WeChat jsapi_ticket');
    }
    generateNonceStr() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++)
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        return result;
    }
    // ============ 公众号运营 API（菜单 / 粉丝 / 模板消息），供 admin GraphQL 代理 ============
    /** 微信 cgi-bin 通用 GET 请求（自动带 access_token，errcode 非 0 抛错） */
    async wxGet(path, cred) {
        const token = await this.getAccessTokenFor(cred);
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/${path}${path.includes('?') ? '&' : '?'}access_token=${token}`, {
            signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS),
        });
        const data = (await res.json());
        if (data.errcode && data.errcode !== 0) {
            throw new Error(`WeChat API ${data.errcode}: ${data.errmsg}`);
        }
        return data;
    }
    async wxPost(path, payload, cred) {
        const token = await this.getAccessTokenFor(cred);
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/${path}?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS),
        });
        const data = (await res.json());
        if (data.errcode && data.errcode !== 0) {
            throw new Error(`WeChat API ${data.errcode}: ${data.errmsg}`);
        }
        return data;
    }
    /** 拉取当前公众号自定义菜单（get_current_selfmenu_info） */
    async getOfficialMenu() {
        return this.wxGet('get_current_selfmenu_info');
    }
    /** 发布自定义菜单（menu/create） */
    async createOfficialMenu(menu) {
        return this.wxPost('menu/create', menu);
    }
    /** 删除自定义菜单（menu/delete） */
    async deleteOfficialMenu() {
        return this.wxGet('menu/delete');
    }
    /** 粉丝 openid 列表（user/get，支持 next_openid 分页） */
    async getFans(nextOpenid) {
        const p = nextOpenid ? `user/get?next_openid=${encodeURIComponent(nextOpenid)}` : 'user/get';
        return this.wxGet(p);
    }
    /** 获取所有私有模板（template/get_all_private_template） */
    async getTemplates() {
        return this.wxGet('template/get_all_private_template');
    }
    /** 发送模板消息（message/template/send） */
    async sendTemplate(input) {
        return this.wxPost('message/template/send', input);
    }
    // ============ 客服消息（48h 窗口内主动推送），供消息回调链路使用 ============
    /**
     * 发送客服文本消息。cred 传渠道覆盖凭证（appId/appSecret），
     * 未传或与主 appId 一致时走主 access_token。
     */
    async sendCustomText(touser, content, cred) {
        return this.wxPost('message/custom/send', { touser, msgtype: 'text', text: { content } }, cred);
    }
    /** 发送客服图文消息（news，最多 8 条；imageUrl 必须为公网可访问的绝对地址） */
    async sendCustomNews(touser, articles, cred) {
        return this.wxPost('message/custom/send', { touser, msgtype: 'news', news: { articles } }, cred);
    }
};
exports.WechatAuthService = WechatAuthService;
exports.WechatAuthService = WechatAuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(constants_1.WECHAT_AUTH_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object])
], WechatAuthService);
//# sourceMappingURL=wechat-auth.service.js.map