"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatAuthenticationStrategy = void 0;
const graphql_tag_1 = require("graphql-tag");
const core_1 = require("@vendure/core");
const cjk_plugin_1 = require("@vendure/cjk-plugin");
const constants_1 = require("./constants");
/** 微信登录换取 openid 的出站超时：超时即登录失败，不能挂住请求 */
const WECHAT_LOGIN_TIMEOUT_MS = 5000;
class WechatAuthenticationStrategy {
    constructor(options) {
        this.options = options;
        this.name = 'wechat';
    }
    async init(injector) {
        this.userService = injector.get(core_1.UserService);
        this.customerService = injector.get(core_1.CustomerService);
    }
    defineInputType() {
        return (0, graphql_tag_1.gql) `
            input WechatAuthInput {
                code: String!
                type: String!
            }
        `;
    }
    async authenticate(ctx, data) {
        // 租户级登录方式开关检查（先于 devBypass）
        if (!(0, cjk_plugin_1.isAuthMethodEnabled)(ctx, 'wechat')) {
            throw new core_1.ForbiddenError();
        }
        // devBypass 分支：跳过微信 API，使用固定测试 openid（保持原样，不使用 override）
        if (this.options.devBypass) {
            const testOpenid = this.options.devBypassOpenid || 'dev_test_openid';
            const identifier = `wechat_${data.type}_${testOpenid}`;
            const user = await this.userService.getUserByEmailAddress(ctx, identifier);
            if (user)
                return user;
            const result = await this.userService.createCustomerUser(ctx, identifier);
            if ('identifier' in result) {
                return result;
            }
            return false;
        }
        // 租户凭证覆盖（已解密；无覆盖则回退 this.options）
        const override = (0, cjk_plugin_1.getAuthOverride)(ctx, 'wechat');
        const appId = (override === null || override === void 0 ? void 0 : override.appId) || this.options.appId;
        const appSecret = (override === null || override === void 0 ? void 0 : override.appSecret) || this.options.appSecret;
        const miniProgramAppId = (override === null || override === void 0 ? void 0 : override.miniProgramAppId) || this.options.miniProgramAppId;
        const miniProgramAppSecret = (override === null || override === void 0 ? void 0 : override.miniProgramAppSecret) || this.options.miniProgramAppSecret;
        const token = (override === null || override === void 0 ? void 0 : override.token) || this.options.token;
        const encodingAESKey = (override === null || override === void 0 ? void 0 : override.encodingAESKey) || this.options.encodingAESKey;
        const { code, type } = data;
        try {
            let openid;
            let userInfo = null;
            if (type === 'mp') {
                const mpResult = await this.getMpOpenidWithInfo(code, appId, appSecret);
                openid = mpResult.openid;
                userInfo = mpResult.userInfo;
            }
            else {
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
                    user = result;
                }
                else {
                    return false;
                }
            }
            // Update openid in custom fields
            try {
                const customer = await this.customerService.findOneByUserId(ctx, user.id);
                if (customer) {
                    const customFields = {};
                    if (type === 'mp') {
                        customFields.wechatOpenid = openid;
                        // If we got user info from snsapi_userinfo, update name
                        if (userInfo === null || userInfo === void 0 ? void 0 : userInfo.nickname) {
                            await this.customerService.update(ctx, {
                                id: customer.id,
                                firstName: userInfo.nickname,
                                customFields: { wechatOpenid: openid },
                            });
                        }
                        else {
                            await this.customerService.update(ctx, {
                                id: customer.id,
                                customFields: { wechatOpenid: openid },
                            });
                        }
                    }
                    else {
                        customFields.wechatMiniOpenid = openid;
                        await this.customerService.update(ctx, {
                            id: customer.id,
                            customFields: { wechatMiniOpenid: openid },
                        });
                    }
                }
            }
            catch (e) {
                core_1.Logger.warn(`Failed to update openid custom fields: ${e.message}`, constants_1.loggerCtx);
            }
            return user;
        }
        catch (e) {
            core_1.Logger.error(`WeChat auth failed: ${String(e.message)}`, constants_1.loggerCtx);
            return false;
        }
    }
    async getMpOpenidWithInfo(code, appId, appSecret) {
        var _a;
        const url = `https://api.weixin.qq.com/sns/oauth2/access_token` +
            `?appid=${appId}&secret=${appSecret}` +
            `&code=${code}&grant_type=authorization_code`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_LOGIN_TIMEOUT_MS) });
        const data = (await response.json());
        if (!data.openid) {
            return { openid: '', userInfo: null };
        }
        // If scope was snsapi_userinfo, we can fetch user profile
        let userInfo = null;
        if (data.access_token && ((_a = data.scope) === null || _a === void 0 ? void 0 : _a.includes('snsapi_userinfo'))) {
            try {
                const infoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${data.access_token}&openid=${data.openid}&lang=zh_CN`;
                const infoRes = await fetch(infoUrl, {
                    signal: AbortSignal.timeout(WECHAT_LOGIN_TIMEOUT_MS),
                });
                userInfo = await infoRes.json();
            }
            catch (e) {
                core_1.Logger.warn('Failed to fetch WeChat user info', constants_1.loggerCtx);
            }
        }
        return { openid: data.openid, userInfo };
    }
    async getMiniOpenid(code, miniProgramAppId, miniProgramAppSecret, appId, appSecret) {
        const finalAppId = miniProgramAppId || appId;
        const finalSecret = miniProgramAppSecret || appSecret;
        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${finalAppId}&secret=${finalSecret}&js_code=${code}&grant_type=authorization_code`;
        const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_LOGIN_TIMEOUT_MS) });
        const data = (await response.json());
        return data.openid;
    }
}
exports.WechatAuthenticationStrategy = WechatAuthenticationStrategy;
//# sourceMappingURL=wechat-auth-strategy.js.map