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

    // An option read from an environment variable that is not set arrives as `undefined`, and must
    // fall back to its default rather than erase it.
    it('ignores undefined oauth values instead of overwriting the defaults', () => {
        const resolved = resolveMcpPluginOptions({
            oauth: { tokenSecret: 's', adminConsentPath: undefined, accessTokenTtlSeconds: undefined },
        });
        expect(resolved.oauth?.adminConsentPath).toBe(DEFAULT_OAUTH_OPTIONS.adminConsentPath);
        expect(resolved.oauth?.accessTokenTtlSeconds).toBe(DEFAULT_OAUTH_OPTIONS.accessTokenTtlSeconds);
    });

    it('ignores an undefined per-tool entry instead of removing the shipped cap', () => {
        const resolved = resolveMcpPluginOptions({ rateLimits: { perTool: { place_order: undefined } } });
        expect(resolved.rateLimits.perTool.place_order).toEqual({ rpm: 5 });
    });

    it('rejects a shopAccess value that is not one of the documented modes', () => {
        expect(() => resolveMcpPluginOptions({ shopAccess: 'Disabled' as any })).toThrow(
            /shopAccess must be one of anonymous, authenticated, disabled, got Disabled\./,
        );
    });

    it('rejects a toolExposure value that is not one of the documented modes', () => {
        expect(() => resolveMcpPluginOptions({ toolExposure: 'all' as any })).toThrow(
            /toolExposure must be one of direct, discovery, got all\./,
        );
    });

    it('rejects a logging.capture value that is not one of the documented modes', () => {
        expect(() => resolveMcpPluginOptions({ logging: { capture: 'everything' as any } })).toThrow(
            /logging\.capture must be one of metadata, full, got everything\./,
        );
    });

    // Without an oauth block the shop endpoint challenges every request with an issuer it does not have.
    it('rejects shopAccess "authenticated" without an oauth block', () => {
        expect(() => resolveMcpPluginOptions({ shopAccess: 'authenticated' })).toThrow(
            /shopAccess "authenticated" needs an oauth block/,
        );
    });

    it('accepts shopAccess "authenticated" with an oauth block', () => {
        const resolved = resolveMcpPluginOptions({
            shopAccess: 'authenticated',
            oauth: { tokenSecret: 's' },
        });
        expect(resolved.shopAccess).toBe('authenticated');
    });

    it.each([-1, NaN, Infinity])('rejects logging.ttlDays of %s', value => {
        expect(() => resolveMcpPluginOptions({ logging: { ttlDays: value } })).toThrow(
            /logging\.ttlDays must be a non-negative finite number/,
        );
    });

    it.each([-1, NaN, Infinity])('rejects oauth.grantRetentionDays of %s', value => {
        expect(() =>
            resolveMcpPluginOptions({ oauth: { tokenSecret: 's', grantRetentionDays: value } }),
        ).toThrow(/oauth\.grantRetentionDays must be a non-negative finite number/);
    });

    it('accepts 0 for both retention windows, which means keep forever', () => {
        const resolved = resolveMcpPluginOptions({
            logging: { ttlDays: 0 },
            oauth: { tokenSecret: 's', grantRetentionDays: 0 },
        });
        expect(resolved.logging.ttlDays).toBe(0);
        expect(resolved.oauth?.grantRetentionDays).toBe(0);
    });

    it.each([-1, NaN, Infinity])('rejects rateLimits.perSession rpm of %s', value => {
        expect(() => resolveMcpPluginOptions({ rateLimits: { perSession: { rpm: value } } })).toThrow(
            /rateLimits\.perSession\.rpm must be a non-negative finite number/,
        );
    });

    it.each(['perUser', 'perClient', 'anonymousIp', 'oauthIp'] as const)(
        'rejects a negative rpm on rateLimits.%s',
        option => {
            expect(() => resolveMcpPluginOptions({ rateLimits: { [option]: { rpm: -1 } } })).toThrow(
                new RegExp(`rateLimits\\.${option}\\.rpm must be a non-negative finite number`),
            );
        },
    );

    it('rejects a NaN rpm on a perTool entry, naming the tool', () => {
        expect(() =>
            resolveMcpPluginOptions({ rateLimits: { perTool: { place_order: { rpm: NaN } } } }),
        ).toThrow(/rateLimits\.perTool\.place_order\.rpm must be a non-negative finite number/);
    });

    it('accepts an rpm of 0, which means the bucket is off', () => {
        const resolved = resolveMcpPluginOptions({ rateLimits: { perSession: { rpm: 0 } } });
        expect(resolved.rateLimits.perSession).toEqual({ rpm: 0 });
    });
});
