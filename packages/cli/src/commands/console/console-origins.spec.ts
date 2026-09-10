import { describe, expect, it } from 'vitest';

import { DEFAULT_CONSOLE_API_URL, DEFAULT_CONSOLE_URL, officialConsoleEnvironment } from './console-origins';

/**
 * The official Console origins, written out again so that changing one in
 * `console-origins.ts` fails a test rather than passing quietly.
 *
 * That is the whole of what this catches. Both copies live in this repository,
 * so neither can tell you that Console has added a deployment; only that
 * somebody edited one of the two places and not the other.
 */
const OFFICIAL_ORIGINS = {
    productionApp: 'https://console.vendure.io',
    productionApi: 'https://api.vendure.io',
    stagingApp: 'https://staging.console.vendure.io',
    stagingApi: 'https://staging.api.vendure.io',
};

describe('officialConsoleEnvironment()', () => {
    it('pins and recognises the official production and staging pairs', () => {
        expect(DEFAULT_CONSOLE_URL).toBe(OFFICIAL_ORIGINS.productionApp);
        expect(DEFAULT_CONSOLE_API_URL).toBe(OFFICIAL_ORIGINS.productionApi);
        expect(
            officialConsoleEnvironment({
                consoleUrl: OFFICIAL_ORIGINS.productionApp,
                apiUrl: OFFICIAL_ORIGINS.productionApi,
            }),
        ).toBe('production');
        expect(
            officialConsoleEnvironment({
                consoleUrl: OFFICIAL_ORIGINS.stagingApp,
                apiUrl: OFFICIAL_ORIGINS.stagingApi,
            }),
        ).toBe('staging');
    });

    // The pair is matched as a pair. Either half from another environment
    // points the run at two deployments at once.
    it.each([
        ['production app with staging API', OFFICIAL_ORIGINS.productionApp, OFFICIAL_ORIGINS.stagingApi],
        ['staging app with production API', OFFICIAL_ORIGINS.stagingApp, OFFICIAL_ORIGINS.productionApi],
    ])('refuses a %s', (_label, consoleUrl, apiUrl) => {
        expect(officialConsoleEnvironment({ consoleUrl, apiUrl })).toBeUndefined();
    });

    // Everything past the host list. Each of these points a request somewhere
    // else while the hostname still reads correctly.
    it.each([
        ['plain http', 'http://console.vendure.io', 'http://api.vendure.io'],
        ['embedded credentials', 'https://user:pw@console.vendure.io', OFFICIAL_ORIGINS.productionApi],
        ['a path', 'https://console.vendure.io/link', OFFICIAL_ORIGINS.productionApi],
        ['a query', 'https://console.vendure.io/?next=x', OFFICIAL_ORIGINS.productionApi],
        ['a fragment', 'https://console.vendure.io/#x', OFFICIAL_ORIGINS.productionApi],
        ['a lookalike host', 'https://console.vendure.io.evil.test', OFFICIAL_ORIGINS.productionApi],
        ['a subdomain of an official host', 'https://a.console.vendure.io', OFFICIAL_ORIGINS.productionApi],
        ['an unparseable URL', 'not a url', OFFICIAL_ORIGINS.productionApi],
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
