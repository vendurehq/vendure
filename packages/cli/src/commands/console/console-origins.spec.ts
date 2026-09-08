import { describe, expect, it } from 'vitest';

import {
    DEFAULT_CONSOLE_API_URL,
    DEFAULT_CONSOLE_URL,
    officialConsoleEnvironment,
} from './console-origins';

/**
 * The literals the Platform sign-in validator uses
 * (`libs/console-auth/src/origins.ts`). They are repeated here rather than
 * imported, because that package is not public and `@vendure/cli` may not
 * depend on it. Repeating them is only safe if a change on either side fails a
 * test, which is what this file is for.
 */
const PLATFORM_ORIGINS = {
    productionApp: 'https://console.vendure.io',
    productionApi: 'https://api.vendure.io',
    stagingApp: 'https://staging.console.vendure.io',
    stagingApi: 'https://staging.api.vendure.io',
};

describe('officialConsoleEnvironment()', () => {
    it('uses the same literals as the Platform validator', () => {
        expect(DEFAULT_CONSOLE_URL).toBe(PLATFORM_ORIGINS.productionApp);
        expect(DEFAULT_CONSOLE_API_URL).toBe(PLATFORM_ORIGINS.productionApi);
        expect(
            officialConsoleEnvironment({
                consoleUrl: PLATFORM_ORIGINS.stagingApp,
                apiUrl: PLATFORM_ORIGINS.stagingApi,
            }),
        ).toBe('staging');
    });

    it('names both official deployments', () => {
        expect(
            officialConsoleEnvironment({
                consoleUrl: PLATFORM_ORIGINS.productionApp,
                apiUrl: PLATFORM_ORIGINS.productionApi,
            }),
        ).toBe('production');
        // Refusing staging is as wrong as accepting an unknown host.
        expect(
            officialConsoleEnvironment({
                consoleUrl: PLATFORM_ORIGINS.stagingApp,
                apiUrl: PLATFORM_ORIGINS.stagingApi,
            }),
        ).toBe('staging');
    });

    it('accepts a trailing slash, which names the same origin', () => {
        expect(
            officialConsoleEnvironment({
                consoleUrl: `${PLATFORM_ORIGINS.productionApp}/`,
                apiUrl: `${PLATFORM_ORIGINS.productionApi}/`,
            }),
        ).toBe('production');
    });

    // The pair is matched as a pair. Either half from another environment
    // points the run at two deployments at once.
    it.each([
        ['production app with staging API', PLATFORM_ORIGINS.productionApp, PLATFORM_ORIGINS.stagingApi],
        ['staging app with production API', PLATFORM_ORIGINS.stagingApp, PLATFORM_ORIGINS.productionApi],
    ])('refuses a %s', (_label, consoleUrl, apiUrl) => {
        expect(officialConsoleEnvironment({ consoleUrl, apiUrl })).toBeUndefined();
    });

    // Everything past the host list. Each of these points a request somewhere
    // else while the hostname still reads correctly.
    it.each([
        ['plain http', 'http://console.vendure.io', 'http://api.vendure.io'],
        ['embedded credentials', 'https://user:pw@console.vendure.io', PLATFORM_ORIGINS.productionApi],
        ['a path', 'https://console.vendure.io/link', PLATFORM_ORIGINS.productionApi],
        ['a query', 'https://console.vendure.io/?next=x', PLATFORM_ORIGINS.productionApi],
        ['a fragment', 'https://console.vendure.io/#x', PLATFORM_ORIGINS.productionApi],
        ['a lookalike host', 'https://console.vendure.io.evil.test', PLATFORM_ORIGINS.productionApi],
        ['a subdomain of an official host', 'https://a.console.vendure.io', PLATFORM_ORIGINS.productionApi],
        ['an unparseable URL', 'not a url', PLATFORM_ORIGINS.productionApi],
    ])('refuses %s', (_label, consoleUrl, apiUrl) => {
        expect(officialConsoleEnvironment({ consoleUrl, apiUrl })).toBeUndefined();
    });

    // Loopback is a development and test convenience. It is not an official
    // origin, and nothing deciding whether to release a credential may read it
    // as one. This is the difference between this check and the absence of a
    // custom-endpoint prompt, which does permit loopback.
    it.each([
        ['IPv4 loopback', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
        ['IPv6 loopback', 'http://[::1]:3000', 'http://[::1]:3001'],
        ['localhost', 'http://localhost:3000', 'http://localhost:3001'],
    ])('does not treat %s as official', (_label, consoleUrl, apiUrl) => {
        expect(officialConsoleEnvironment({ consoleUrl, apiUrl })).toBeUndefined();
    });
});
