import { describe, expect, it, vi } from 'vitest';

import { defaultConfig } from './config/default-config';
import { RuntimeVendureConfig } from './config/vendure-config';
import {
    getCorsConfigWarning,
    getCsrfPreventionWarning,
    warnAboutInsecureApiConfig,
} from './get-api-security-warnings';

function makeConfig(
    apiOptions: Partial<RuntimeVendureConfig['apiOptions']>,
    authOptions: Partial<RuntimeVendureConfig['authOptions']> = {},
) {
    return {
        apiOptions: { cors: { origin: true, credentials: true }, ...apiOptions },
        authOptions: { tokenMethod: 'cookie', cookieOptions: { sameSite: 'lax' }, ...authOptions },
    } as Pick<RuntimeVendureConfig, 'apiOptions' | 'authOptions'>;
}

describe('getCorsConfigWarning', () => {
    it('warns for reflected origin plus credentials', () => {
        const warning = getCorsConfigWarning(makeConfig({}), { nodeEnv: 'production' });
        expect(warning).toMatch(/Insecure CORS configuration/);
        expect(warning).toMatch(/apiOptions\.cors\.origin/);
    });

    it('does not warn when the origin is an explicit allowlist', () => {
        const config = makeConfig({
            cors: { origin: ['https://storefront.example.com'], credentials: true },
        });
        expect(getCorsConfigWarning(config, { nodeEnv: 'production' })).toBeUndefined();
    });

    it('does not warn when credentials are not allowed', () => {
        const config = makeConfig({ cors: { origin: true, credentials: false } });
        expect(getCorsConfigWarning(config, { nodeEnv: 'production' })).toBeUndefined();
    });

    it('does not warn for the boolean cors shorthands', () => {
        expect(getCorsConfigWarning(makeConfig({ cors: true }), { nodeEnv: 'production' })).toBeUndefined();
        expect(getCorsConfigWarning(makeConfig({ cors: false }), { nodeEnv: 'production' })).toBeUndefined();
    });

    it('is silent in the test environment', () => {
        expect(getCorsConfigWarning(makeConfig({}), { nodeEnv: 'test' })).toBeUndefined();
    });

    it('warns in development, not only in production', () => {
        expect(getCorsConfigWarning(makeConfig({}), { nodeEnv: 'development' })).toMatch(
            /Insecure CORS configuration/,
        );
    });

    it('adds the cross-site cookie note when sameSite is none', () => {
        const config = makeConfig({}, { cookieOptions: { sameSite: 'none' } });
        expect(getCorsConfigWarning(config, { nodeEnv: 'production' })).toMatch(
            /browsers\s+do attach it to cross-site requests/,
        );
    });

    it('adds the cross-site cookie note when sameSite is false', () => {
        const config = makeConfig({}, { cookieOptions: { sameSite: false } });
        expect(getCorsConfigWarning(config, { nodeEnv: 'production' })).toMatch(
            /browsers\s+do attach it to cross-site requests/,
        );
    });

    it('adds the cross-site cookie note when tokenMethod includes cookie alongside bearer', () => {
        const config = makeConfig(
            {},
            { tokenMethod: ['bearer', 'cookie'], cookieOptions: { sameSite: 'none' } },
        );
        expect(getCorsConfigWarning(config, { nodeEnv: 'production' })).toMatch(
            /browsers\s+do attach it to cross-site requests/,
        );
    });

    it('tells the reader the default is only acceptable in local development', () => {
        expect(getCorsConfigWarning(makeConfig({}), { nodeEnv: 'production' })).toMatch(
            /Do not deploy with it/,
        );
    });

    it('omits the cross-site cookie note for the default sameSite lax', () => {
        expect(getCorsConfigWarning(makeConfig({}), { nodeEnv: 'production' })).not.toMatch(
            /cross-site requests/,
        );
    });

    it('omits the cross-site cookie note when only bearer tokens are used', () => {
        const config = makeConfig({}, { tokenMethod: 'bearer', cookieOptions: { sameSite: 'none' } });
        expect(getCorsConfigWarning(config, { nodeEnv: 'production' })).not.toMatch(/cross-site requests/);
    });

    it('says nothing about csrfPrevention, which is reported on its own', () => {
        expect(getCorsConfigWarning(makeConfig({}), { nodeEnv: 'production' })).not.toMatch(/csrfPrevention/);
    });
});

describe('getCsrfPreventionWarning', () => {
    it('warns when csrfPrevention is off and sessions use cookies', () => {
        const warning = getCsrfPreventionWarning(makeConfig({}), { nodeEnv: 'production' });
        expect(warning).toMatch(/Login CSRF is possible/);
        expect(warning).toMatch(/apiOptions\.csrfPrevention: true/);
    });

    it('warns even when the CORS origin is an explicit allowlist', () => {
        // Login CSRF does not go through CORS, so an allowlist does not make it safe.
        const config = makeConfig({
            cors: { origin: ['https://storefront.example.com'], credentials: true },
        });
        expect(getCsrfPreventionWarning(config, { nodeEnv: 'production' })).toMatch(/Login CSRF is possible/);
    });

    it('warns when tokenMethod includes cookie alongside bearer', () => {
        const config = makeConfig({}, { tokenMethod: ['bearer', 'cookie'] });
        expect(getCsrfPreventionWarning(config, { nodeEnv: 'production' })).toMatch(/Login CSRF is possible/);
    });

    it('does not warn when csrfPrevention is on', () => {
        const config = makeConfig({ csrfPrevention: true });
        expect(getCsrfPreventionWarning(config, { nodeEnv: 'production' })).toBeUndefined();
    });

    it('does not warn for bearer-only deployments', () => {
        const config = makeConfig({}, { tokenMethod: 'bearer' });
        expect(getCsrfPreventionWarning(config, { nodeEnv: 'production' })).toBeUndefined();
    });

    it('is silent in the test environment', () => {
        expect(getCsrfPreventionWarning(makeConfig({}), { nodeEnv: 'test' })).toBeUndefined();
    });

    it('names the header that clients uploading files or querying over GET must send', () => {
        expect(getCsrfPreventionWarning(makeConfig({}), { nodeEnv: 'production' })).toMatch(
            /Apollo-Require-Preflight/,
        );
    });
});

describe('the shipped defaultConfig', () => {
    it('still reflects any origin and leaves csrfPrevention off, and triggers both warnings', () => {
        // This patch deliberately does not change either default. Tightening `cors.origin` would
        // break every existing storefront and dev setup, and enabling `csrfPrevention` would break
        // clients that upload files without the preflight header. Both belong to a major release.
        expect(defaultConfig.apiOptions.cors).toEqual({ origin: true, credentials: true });
        expect(defaultConfig.apiOptions.csrfPrevention).toBe(false);
        expect(getCorsConfigWarning(defaultConfig, { nodeEnv: 'production' })).toMatch(
            /Insecure CORS configuration/,
        );
        expect(getCsrfPreventionWarning(defaultConfig, { nodeEnv: 'production' })).toMatch(
            /Login CSRF is possible/,
        );
    });
});

describe('warnAboutInsecureApiConfig', () => {
    it('logs both warnings for the default config', () => {
        const logger = { warn: vi.fn() };
        warnAboutInsecureApiConfig(makeConfig({}), { nodeEnv: 'production', logger });
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.warn.mock.calls[0][0]).toMatch(/Insecure CORS configuration/);
        expect(logger.warn.mock.calls[1][0]).toMatch(/Login CSRF is possible/);
    });

    it('logs only the CSRF warning when the CORS origin is an allowlist', () => {
        const logger = { warn: vi.fn() };
        const config = makeConfig({
            cors: { origin: ['https://storefront.example.com'], credentials: true },
        });
        warnAboutInsecureApiConfig(config, { nodeEnv: 'production', logger });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatch(/Login CSRF is possible/);
    });

    it('logs nothing for a fully hardened configuration', () => {
        const logger = { warn: vi.fn() };
        const config = makeConfig({
            cors: { origin: ['https://storefront.example.com'], credentials: true },
            csrfPrevention: true,
        });
        warnAboutInsecureApiConfig(config, { nodeEnv: 'production', logger });
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('logs nothing in the test environment', () => {
        const logger = { warn: vi.fn() };
        warnAboutInsecureApiConfig(makeConfig({}), { nodeEnv: 'test', logger });
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
