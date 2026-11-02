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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatAuthController = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const wechat_auth_service_1 = require("./wechat-auth.service");
let WechatAuthController = class WechatAuthController {
    constructor(options, wechatAuthService) {
        this.options = options;
        this.wechatAuthService = wechatAuthService;
    }
    /**
     * JS-SDK 签名接口（公开只读）：GET /wechat-auth/jssdk-signature?url=<当前页面URL>
     * 返回 wx.config 所需的 appId/timestamp/nonceStr/signature
     */
    async jssdkSignature(url, res) {
        if (!url) {
            res.status(400).json({ error: 'Missing url parameter' });
            return;
        }
        try {
            // 去掉微信会在签名校验时忽略的 hash 部分
            const cleanUrl = url.split('#')[0];
            const signature = await this.wechatAuthService.generateJsapiSignature(cleanUrl);
            res.json(signature);
        }
        catch (e) {
            core_1.Logger.error(`JS-SDK signature error: ${String(e.message)}`, constants_1.loggerCtx);
            res.status(500).json({ error: 'Failed to generate signature' });
        }
    }
    async callback(req, res, code) {
        if (!code) {
            res.status(400).send('Missing code parameter');
            return;
        }
        try {
            const url = `https://api.weixin.qq.com/sns/oauth2/access_token` +
                `?appid=${this.options.appId}&secret=${this.options.appSecret}` +
                `&code=${code}&grant_type=authorization_code`;
            const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
            const data = await response.json();
            if (data.openid) {
                core_1.Logger.info(`WeChat OAuth callback received for openid: ${String(data.openid)}`, constants_1.loggerCtx);
                res.redirect(`/?wechat_code=${code}&openid=${String(data.openid)}`);
            }
            else {
                core_1.Logger.error(`WeChat OAuth callback failed: ${JSON.stringify(data)}`, constants_1.loggerCtx);
                res.status(400).send('WeChat OAuth failed');
            }
        }
        catch (e) {
            core_1.Logger.error(`WeChat OAuth callback error: ${String(e.message)}`, constants_1.loggerCtx);
            res.status(500).send('Internal error');
        }
    }
};
exports.WechatAuthController = WechatAuthController;
__decorate([
    (0, common_1.Get)('jssdk-signature'),
    __param(0, (0, common_1.Query)('url')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], WechatAuthController.prototype, "jssdkSignature", null);
__decorate([
    (0, common_1.Get)('callback'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], WechatAuthController.prototype, "callback", null);
exports.WechatAuthController = WechatAuthController = __decorate([
    (0, common_1.Controller)('wechat-auth'),
    __param(0, (0, common_1.Inject)(constants_1.WECHAT_AUTH_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, wechat_auth_service_1.WechatAuthService])
], WechatAuthController);
//# sourceMappingURL=wechat-auth.controller.js.map