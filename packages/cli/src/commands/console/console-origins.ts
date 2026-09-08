/**
 * The official Vendure Console origins, and the check that recognises them.
 *
 * These literals and the rules below mirror the Platform sign-in validator
 * (`libs/console-auth/src/origins.ts`). They are copied rather than imported,
 * because that package is not public and `@vendure/cli` may not depend on it.
 *
 * The copies are maintained by hand. Nothing here can detect a change made on
 * the other side, because that source is not in this repository and the tests
 * compare these literals against a second copy of the same literals. Adding an
 * official origin means editing both, and knowing to.
 *
 * The checks past the host list matter as much as the list. A URL carrying a
 * path, a query, a fragment or credentials is a URL built to be appended to,
 * and each of those points a request somewhere else while the hostname still
 * reads correctly.
 */

/** An official Console deployment. Anything else is not official. */
export type ConsoleOriginEnvironment = 'production' | 'staging';

export const DEFAULT_CONSOLE_URL = 'https://console.vendure.io';
export const DEFAULT_CONSOLE_API_URL = 'https://api.vendure.io';

const STAGING_CONSOLE_URL = 'https://staging.console.vendure.io';
const STAGING_CONSOLE_API_URL = 'https://staging.api.vendure.io';

/**
 * Paired on purpose. A Console app origin from one environment with an API
 * origin from another is not an official pair, it is a request pointed at two
 * deployments at once.
 */
const OFFICIAL_CONSOLE_ORIGINS: ReadonlyArray<{
    environment: ConsoleOriginEnvironment;
    consoleUrl: string;
    apiUrl: string;
}> = [
    { environment: 'production', consoleUrl: DEFAULT_CONSOLE_URL, apiUrl: DEFAULT_CONSOLE_API_URL },
    { environment: 'staging', consoleUrl: STAGING_CONSOLE_URL, apiUrl: STAGING_CONSOLE_API_URL },
];

/**
 * Which official Console the given pair is, or `undefined` when it is not one.
 *
 * `undefined` covers a loopback pair as well as an unknown host. Loopback is a
 * development and test convenience, not an official origin, and nothing that
 * decides whether to release a credential may treat it as one.
 */
export function officialConsoleEnvironment(endpoints: {
    consoleUrl: string;
    apiUrl: string;
}): ConsoleOriginEnvironment | undefined {
    return OFFICIAL_CONSOLE_ORIGINS.find(
        pair =>
            isOfficialOrigin(endpoints.consoleUrl, pair.consoleUrl) &&
            isOfficialOrigin(endpoints.apiUrl, pair.apiUrl),
    )?.environment;
}

function isOfficialOrigin(value: string, official: string): boolean {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        url.origin === official
    );
}
