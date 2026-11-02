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
exports.SsoProviderService = void 0;
// packages/cjk-plugin/src/auth/sso-provider.service.ts
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const crypto_1 = require("./crypto");
/** SSO 探测/登录出站超时：超时快速失败，避免管理端测试或登录挂住 */
const SSO_HTTP_TIMEOUT_MS = 5000;
let SsoProviderService = class SsoProviderService {
    constructor(channelService) {
        this.channelService = channelService;
    }
    async getProviders(ctx, channelId) {
        var _a;
        const channel = await this.channelService.findOne(ctx, channelId);
        if (!channel)
            return [];
        const rawStruct = (_a = channel.customFields) === null || _a === void 0 ? void 0 : _a.authConfig;
        if (!rawStruct)
            return [];
        const domain = (0, crypto_1.parseAndDecryptStruct)(rawStruct);
        if (!domain)
            return [];
        return domain.ssoProviders || [];
    }
    async testConnection(ctx, channelId, providerKey, newClientSecret) {
        const providers = await this.getProviders(ctx, channelId);
        const provider = providers.find(p => p.providerKey === providerKey);
        if (!provider)
            return { success: false, latencyMs: 0, error: 'Provider not found' };
        const clientSecret = newClientSecret || provider.clientSecret;
        const start = Date.now();
        try {
            // 优先尝试 client_credentials
            const tokenUrl = `${provider.baseUrl.replace(/\/$/, '')}/v1/auth/token`;
            const resp = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'client_credentials',
                    app_code: provider.clientId,
                    app_secret: clientSecret,
                }),
                signal: AbortSignal.timeout(SSO_HTTP_TIMEOUT_MS),
            });
            const latencyMs = Date.now() - start;
            if (resp.ok)
                return { success: true, latencyMs };
            // 降级:GET health 端点
            if (resp.status === 400 || resp.status === 401) {
                const healthUrl = `${provider.baseUrl.replace(/\/$/, '')}/v1/auth/authorize`;
                const healthResp = await fetch(healthUrl, {
                    method: 'GET',
                    signal: AbortSignal.timeout(SSO_HTTP_TIMEOUT_MS),
                });
                return {
                    success: healthResp.status < 500,
                    latencyMs: Date.now() - start,
                    error: healthResp.status < 500 ? undefined : `Health check failed: ${healthResp.status}`,
                };
            }
            return { success: false, latencyMs, error: `Token endpoint returned ${resp.status}` };
        }
        catch (e) {
            const timedOut = (e === null || e === void 0 ? void 0 : e.name) === 'TimeoutError' || (e === null || e === void 0 ? void 0 : e.name) === 'AbortError';
            return {
                success: false,
                latencyMs: Date.now() - start,
                error: timedOut ? `连接超时(${SSO_HTTP_TIMEOUT_MS}ms)` : e.message,
            };
        }
    }
};
exports.SsoProviderService = SsoProviderService;
exports.SsoProviderService = SsoProviderService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.ChannelService])
], SsoProviderService);
//# sourceMappingURL=sso-provider.service.js.map