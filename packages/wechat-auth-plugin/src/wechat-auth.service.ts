import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import * as crypto from 'crypto';
import { WechatAuthPluginOptions } from './types';
import { WECHAT_AUTH_PLUGIN_OPTIONS } from './constants';
import { loggerCtx } from './constants';

/** 微信出站 API 超时：登录/取 token 必须快速失败，避免请求挂死拖住线程 */
const WECHAT_HTTP_TIMEOUT_MS = 5000;

interface TokenCache {
    token: string;
    expiresAt: number;
}

@Injectable()
export class WechatAuthService {
    private accessTokenCache: TokenCache | null = null;
    private miniProgramTokenCacheMap = new Map<string, TokenCache>();
    private miniProgramTokenPromiseMap = new Map<string, Promise<string>>();
    private ticketCache: TokenCache | null = null;
    private accessTokenPromise: Promise<string> | null = null;
    private ticketPromise: Promise<string> | null = null;
    private readonly REFRESH_BUFFER_SECONDS = 300; // Refresh 5 minutes before expiry

    constructor(@Inject(WECHAT_AUTH_PLUGIN_OPTIONS) private options: WechatAuthPluginOptions) {}

    async getAccessToken(): Promise<string> {
        if (this.accessTokenCache && Date.now() < this.accessTokenCache.expiresAt) {
            return this.accessTokenCache.token;
        }
        if (this.accessTokenPromise) return this.accessTokenPromise;
        this.accessTokenPromise = this.fetchAccessToken().finally(() => {
            this.accessTokenPromise = null;
        });
        return this.accessTokenPromise;
    }

    async getJsapiTicket(): Promise<string> {
        if (this.ticketCache && Date.now() < this.ticketCache.expiresAt) {
            return this.ticketCache.token;
        }
        if (this.ticketPromise) return this.ticketPromise;
        this.ticketPromise = this.fetchJsapiTicket().finally(() => {
            this.ticketPromise = null;
        });
        return this.ticketPromise;
    }

    async getMiniProgramAccessToken(appId: string, appSecret: string): Promise<string> {
        const cached = this.miniProgramTokenCacheMap.get(appId);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.token;
        }
        // 并发去重
        const existing = this.miniProgramTokenPromiseMap.get(appId);
        if (existing) return existing;
        const promise = this.fetchAccessTokenByCredentials(appId, appSecret).finally(() => {
            this.miniProgramTokenPromiseMap.delete(appId);
        });
        this.miniProgramTokenPromiseMap.set(appId, promise);
        return promise;
    }

    private async fetchAccessTokenByCredentials(appId: string, appSecret: string): Promise<string> {
        const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS) });
        const data = (await response.json()) as any;
        if (data.access_token) {
            this.miniProgramTokenCacheMap.set(appId, {
                token: data.access_token,
                expiresAt: Date.now() + (data.expires_in - this.REFRESH_BUFFER_SECONDS) * 1000,
            });
            Logger.info(`MiniProgram access_token refreshed for appId=${appId}, expires in ${data.expires_in}s`, loggerCtx);
            return data.access_token;
        }
        Logger.error(`Failed to get MiniProgram access_token: ${JSON.stringify(data)}`, loggerCtx);
        throw new Error('Failed to get WeChat MiniProgram access_token');
    }

    async generateJsapiSignature(url: string): Promise<{
        appId: string;
        timestamp: number;
        nonceStr: string;
        signature: string;
    }> {
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

    private async fetchAccessToken(): Promise<string> {
        return this.fetchAccessTokenByCredentials(this.options.appId, this.options.appSecret);
    }

    /** 按凭证取 access_token：未传或与插件主 appId 相同时走主缓存；否则按 appId 独立缓存 */
    private async getAccessTokenFor(cred?: { appId?: string; appSecret?: string }): Promise<string> {
        if (!cred?.appId || !cred.appSecret || cred.appId === this.options.appId) {
            return this.getAccessToken();
        }
        return this.getMiniProgramAccessToken(cred.appId, cred.appSecret);
    }

    private async fetchJsapiTicket(): Promise<string> {
        const accessToken = await this.getAccessToken();
        const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${accessToken}&type=jsapi`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS) });
        const data = (await response.json()) as any;
        if (data.ticket) {
            this.ticketCache = {
                token: data.ticket,
                expiresAt: Date.now() + (data.expires_in - this.REFRESH_BUFFER_SECONDS) * 1000,
            };
            Logger.info(`WeChat jsapi_ticket refreshed, expires in ${data.expires_in}s`, loggerCtx);
            return data.ticket;
        }
        Logger.error(`Failed to get jsapi_ticket: ${JSON.stringify(data)}`, loggerCtx);
        throw new Error('Failed to get WeChat jsapi_ticket');
    }

    private generateNonceStr(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
        return result;
    }

    // ============ 公众号运营 API（菜单 / 粉丝 / 模板消息），供 admin GraphQL 代理 ============

    /** 微信 cgi-bin 通用 GET 请求（自动带 access_token，errcode 非 0 抛错） */
    private async wxGet(path: string, cred?: { appId?: string; appSecret?: string }): Promise<any> {
        const token = await this.getAccessTokenFor(cred);
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/${path}${path.includes('?') ? '&' : '?'}access_token=${token}`, {
            signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS),
        });
        const data = (await res.json()) as any;
        if (data.errcode && data.errcode !== 0) {
            throw new Error(`WeChat API ${data.errcode}: ${data.errmsg}`);
        }
        return data;
    }

    private async wxPost(path: string, payload: any, cred?: { appId?: string; appSecret?: string }): Promise<any> {
        const token = await this.getAccessTokenFor(cred);
        const res = await fetch(`https://api.weixin.qq.com/cgi-bin/${path}?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WECHAT_HTTP_TIMEOUT_MS),
        });
        const data = (await res.json()) as any;
        if (data.errcode && data.errcode !== 0) {
            throw new Error(`WeChat API ${data.errcode}: ${data.errmsg}`);
        }
        return data;
    }

    /** 拉取当前公众号自定义菜单（get_current_selfmenu_info） */
    async getOfficialMenu(): Promise<any> {
        return this.wxGet('get_current_selfmenu_info');
    }

    /** 发布自定义菜单（menu/create） */
    async createOfficialMenu(menu: any): Promise<any> {
        return this.wxPost('menu/create', menu);
    }

    /** 删除自定义菜单（menu/delete） */
    async deleteOfficialMenu(): Promise<any> {
        return this.wxGet('menu/delete');
    }

    /** 粉丝 openid 列表（user/get，支持 next_openid 分页） */
    async getFans(nextOpenid?: string): Promise<any> {
        const p = nextOpenid ? `user/get?next_openid=${encodeURIComponent(nextOpenid)}` : 'user/get';
        return this.wxGet(p);
    }

    /** 获取所有私有模板（template/get_all_private_template） */
    async getTemplates(): Promise<any> {
        return this.wxGet('template/get_all_private_template');
    }

    /** 发送模板消息（message/template/send） */
    async sendTemplate(input: { touser: string; template_id: string; data?: any; url?: string; miniprogram?: any }): Promise<any> {
        return this.wxPost('message/template/send', input);
    }

    // ============ 客服消息（48h 窗口内主动推送），供消息回调链路使用 ============

    /**
     * 发送客服文本消息。cred 传渠道覆盖凭证（appId/appSecret），
     * 未传或与主 appId 一致时走主 access_token。
     */
    async sendCustomText(
        touser: string,
        content: string,
        cred?: { appId?: string; appSecret?: string },
    ): Promise<any> {
        return this.wxPost('message/custom/send', { touser, msgtype: 'text', text: { content } }, cred);
    }

    /** 发送客服图文消息（news，最多 8 条；imageUrl 必须为公网可访问的绝对地址） */
    async sendCustomNews(
        touser: string,
        articles: Array<{ title: string; description?: string; url?: string; picurl?: string }>,
        cred?: { appId?: string; appSecret?: string },
    ): Promise<any> {
        return this.wxPost('message/custom/send', { touser, msgtype: 'news', news: { articles } }, cred);
    }
}
