import { describe, expect, it } from 'vitest';

import { DEFAULT_OAUTH_OPTIONS } from './constants';
import { resolveMcpPluginOptions } from './resolve-options';

describe('resolveMcpPluginOptions', () => {
    it('applies the documented defaults when called with no options', () => {
        const resolved = resolveMcpPluginOptions();
        expect(resolved.toolExposure).toBe('direct');
        expect(resolved.shopAccess).toBe('anonymous');
        expect(resolved.oauth).toBeUndefined();
        expect(resolved.rateLimits.perSession).toEqual({ rpm: 60 });
        expect(resolved.rateLimits.perUser).toEqual({ rpm: 120 });
        expect(resolved.rateLimits.perClient).toEqual({ rpm: 3000 });
        expect(resolved.rateLimits.anonymousIp).toEqual({ rpm: 60 });
        expect(resolved.rateLimits.oauthIp).toEqual({ rpm: 60 });
        expect(Object.keys(resolved.rateLimits.perTool).sort()).toEqual([
            'cancel_order',
            'create_product',
            'place_order',
            'refund_order',
        ]);
        expect(resolved.logging).toMatchObject({
            ttlDays: 30,
            capture: 'metadata',
            maxBodyBytes: 64_000,
            captureClientIp: false,
        });
    });

    it('preserves an explicit `false` for the IP backstops instead of re-enabling them', () => {
        const resolved = resolveMcpPluginOptions({ rateLimits: { anonymousIp: false, oauthIp: false } });
        expect(resolved.rateLimits.anonymousIp).toBe(false);
        expect(resolved.rateLimits.oauthIp).toBe(false);
    });

    it('merges per-tool limits over the defaults without dropping them', () => {
        const resolved = resolveMcpPluginOptions({ rateLimits: { perTool: { my_tool: { rpm: 3 } } } });
        expect(resolved.rateLimits.perTool.my_tool).toEqual({ rpm: 3 });
        expect(resolved.rateLimits.perTool.place_order).toEqual({ rpm: 5 });
    });

    it('fills every DEFAULT_OAUTH_OPTIONS key when oauth is configured, keeping user values', () => {
        const resolved = resolveMcpPluginOptions({ oauth: { tokenSecret: 's', accessTokenTtlSeconds: 1 } });
        expect(resolved.oauth).toMatchObject({
            ...DEFAULT_OAUTH_OPTIONS,
            tokenSecret: 's',
            accessTokenTtlSeconds: 1,
        });
    });
});
