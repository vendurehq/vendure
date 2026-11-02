// packages/cjk-plugin/src/auth/sso-provider.service.ts
import { Injectable } from '@nestjs/common';
import { RequestContext, ChannelService } from '@vendure/core';
import { parseAndDecryptStruct } from './crypto';
import type { SsoProvider } from './auth-config.types';

/** SSO 探测/登录出站超时：超时快速失败，避免管理端测试或登录挂住 */
const SSO_HTTP_TIMEOUT_MS = 5000;

export interface TestSsoResult {
    success: boolean;
    latencyMs: number;
    error?: string;
}

@Injectable()
export class SsoProviderService {
    constructor(private channelService: ChannelService) {}

    async getProviders(ctx: RequestContext, channelId: string): Promise<SsoProvider[]> {
        const channel = await this.channelService.findOne(ctx, channelId as any);
        if (!channel) return [];
        const rawStruct = (channel as any).customFields?.authConfig;
        if (!rawStruct) return [];
        const domain = parseAndDecryptStruct(rawStruct);
        if (!domain) return [];
        return domain.ssoProviders || [];
    }

    async testConnection(
        ctx: RequestContext,
        channelId: string,
        providerKey: string,
        newClientSecret?: string,
    ): Promise<TestSsoResult> {
        const providers = await this.getProviders(ctx, channelId);
        const provider = providers.find(p => p.providerKey === providerKey);
        if (!provider) return { success: false, latencyMs: 0, error: 'Provider not found' };
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
            if (resp.ok) return { success: true, latencyMs };
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
        } catch (e: any) {
            const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
            return {
                success: false,
                latencyMs: Date.now() - start,
                error: timedOut ? `连接超时(${SSO_HTTP_TIMEOUT_MS}ms)` : e.message,
            };
        }
    }
}
