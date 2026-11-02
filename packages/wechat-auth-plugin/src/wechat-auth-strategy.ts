import { DocumentNode } from 'graphql';
import { gql } from 'graphql-tag';
import { AuthenticationStrategy, Customer, CustomerService, ForbiddenError, Injector, Logger, RequestContext, User, UserService } from '@vendure/core';
import { getAuthOverride, isAuthMethodEnabled } from '@vendure/cjk-plugin';

import { loggerCtx } from './constants';
import { WechatAuthPluginOptions } from './types';

/** 微信登录换取 openid 的出站超时：超时即登录失败，不能挂住请求 */
const WECHAT_LOGIN_TIMEOUT_MS = 5000;

export interface WechatAuthData {
    code: string;
    type: 'mp' | 'mini';
}

export class WechatAuthenticationStrategy implements AuthenticationStrategy<WechatAuthData> {
    readonly name = 'wechat';

    private userService: UserService;
    private customerService: CustomerService;

    constructor(private options: WechatAuthPluginOptions) {}

    async init(injector: Injector) {
        this.userService = injector.get(UserService);
        this.customerService = injector.get(CustomerService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input WechatAuthInput {
                code: String!
                type: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: WechatAuthData): Promise<User | false | string> {
        // 租户级登录方式开关检查（先于 devBypass）
        if (!isAuthMethodEnabled(ctx, 'wechat')) {
            throw new ForbiddenError();
        }

        // devBypass 分支：跳过微信 API，使用固定测试 openid（保持原样，不使用 override）
        if (this.options.devBypass) {
            const testOpenid = this.options.devBypassOpenid || 'dev_test_openid';
            const identifier = `wechat_${data.type}_${testOpenid}`;
            const user = await this.userService.getUserByEmailAddress(ctx, identifier);
            if (user) return user;
            const result = await this.userService.createCustomerUser(ctx, identifier);
            if ('identifier' in result) {
                return result as User;
            }
            return false;
        }

        // 租户凭证覆盖（已解密；无覆盖则回退 this.options）
        const override = getAuthOverride(ctx, 'wechat');
        const appId = override?.appId || this.options.appId;
        const appSecret = override?.appSecret || this.options.appSecret;
        const miniProgramAppId = override?.miniProgramAppId || this.options.miniProgramAppId;
        const miniProgramAppSecret = override?.miniProgramAppSecret || this.options.miniProgramAppSecret;
        const token = override?.token || this.options.token;
        const encodingAESKey = override?.encodingAESKey || this.options.encodingAESKey;

        const { code, type } = data;

        try {
            let openid: string;
            let userInfo: { nickname?: string; headimgurl?: string } | null = null;

            if (type === 'mp') {
                const mpResult = await this.getMpOpenidWithInfo(code, appId, appSecret);
                openid = mpResult.openid;
                userInfo = mpResult.userInfo;
            } else {
                openid = await this.getMiniOpenid(code, miniProgramAppId, miniProgramAppSecret, appId, appSecret);
            }

            if (!openid) {
                return '微信授权失败';
            }

            const identifier = type === 'mp' ? `wechat_mp_${openid}` : `wechat_mini_${openid}`;

            // Try to find existing user by identifier
            let user = await this.userService.getUserByEmailAddress(ctx, identifier);

            if (!user) {
                // Create new customer user
                const result = await this.userService.createCustomerUser(ctx, identifier);
                if ('identifier' in result) {
                    user = result as User;
                } else {
                    return false;
                }
            }

            // Update openid in custom fields
            try {
                const customer = await this.customerService.findOneByUserId(ctx, user.id);
                if (customer) {
                    const customFields: Record<string, string> = {};
                    if (type === 'mp') {
                        customFields.wechatOpenid = openid;
                        // If we got user info from snsapi_userinfo, update name
                        if (userInfo?.nickname) {
                            await this.customerService.update(ctx, {
                                id: customer.id,
                                firstName: userInfo.nickname,
                                customFields: { wechatOpenid: openid },
                            });
                        } else {
                            await this.customerService.update(ctx, {
                                id: customer.id,
                                customFields: { wechatOpenid: openid },
                            });
                        }
                    } else {
                        customFields.wechatMiniOpenid = openid;
                        await this.customerService.update(ctx, {
                            id: customer.id,
                            customFields: { wechatMiniOpenid: openid },
                        });
                    }
                }
            } catch (e: any) {
                Logger.warn(`Failed to update openid custom fields: ${e.message}`, loggerCtx);
            }

            return user;
        } catch (e: any) {
            Logger.error(`WeChat auth failed: ${String(e.message)}`, loggerCtx);
            return false;
        }
    }

    private async getMpOpenidWithInfo(code: string, appId: string, appSecret: string): Promise<{ openid: string; userInfo: any }> {
        const url =
            `https://api.weixin.qq.com/sns/oauth2/access_token` +
            `?appid=${appId}&secret=${appSecret}` +
            `&code=${code}&grant_type=authorization_code`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_LOGIN_TIMEOUT_MS) });
        const data = (await response.json()) as any;
        if (!data.openid) {
            return { openid: '', userInfo: null };
        }
        // If scope was snsapi_userinfo, we can fetch user profile
        let userInfo = null;
        if (data.access_token && data.scope?.includes('snsapi_userinfo')) {
            try {
                const infoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${data.access_token}&openid=${data.openid}&lang=zh_CN`;
                const infoRes = await fetch(infoUrl, {
                    signal: AbortSignal.timeout(WECHAT_LOGIN_TIMEOUT_MS),
                });
                userInfo = await infoRes.json();
            } catch (e) {
                Logger.warn('Failed to fetch WeChat user info', loggerCtx);
            }
        }
        return { openid: data.openid, userInfo };
    }

    private async getMiniOpenid(
        code: string,
        miniProgramAppId: string | undefined,
        miniProgramAppSecret: string | undefined,
        appId: string,
        appSecret: string,
    ): Promise<string> {
        const finalAppId = miniProgramAppId || appId;
        const finalSecret = miniProgramAppSecret || appSecret;
        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${finalAppId}&secret=${finalSecret}&js_code=${code}&grant_type=authorization_code`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_LOGIN_TIMEOUT_MS) });
        const data = (await response.json()) as any;
        return data.openid;
    }
}
