import { tokenMethodIncludes } from './api/common/token-method-includes';
import { Logger } from './config/logger/vendure-logger';
import { RuntimeVendureConfig } from './config/vendure-config';

type SecurityConfig = Pick<RuntimeVendureConfig, 'apiOptions' | 'authOptions'>;

const CORS_REMEDIATION_HINT =
    'Set `apiOptions.cors.origin` to an explicit list of the origins you serve, e.g. ' +
    "`{ origin: ['https://storefront.example.com'], credentials: true }`.";

/**
 * @description
 * Returns a warning message when `apiOptions.cors` reflects any incoming `Origin` header
 * back as `Access-Control-Allow-Origin` while also setting `Access-Control-Allow-Credentials: true`.
 * Returns `undefined` when the configuration does not have that combination.
 *
 * This combination lets any website on the internet make cross-origin requests to the Shop and
 * Admin APIs. How much that is worth to an attacker depends on the session transport, so the
 * message says more when the session cookie is also allowed on cross-site requests.
 *
 * Exported for unit testing. Production callers go through `bootstrap()`.
 */
export function getCorsConfigWarning(
    config: SecurityConfig,
    options: { nodeEnv?: string } = {},
): string | undefined {
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
    if (nodeEnv === 'test') {
        return undefined;
    }
    const { cors } = config.apiOptions;
    // `cors: true` and `cors: false` do not enable credentials, so the reflected-origin
    // risk does not apply to them. A regex or a function origin can also match every
    // origin, but that cannot be detected reliably, so it is left alone.
    if (typeof cors !== 'object') {
        return undefined;
    }
    if (cors.origin !== true || cors.credentials !== true) {
        return undefined;
    }
    const parts = [
        'Insecure CORS configuration: `apiOptions.cors` reflects any `Origin` header (`origin: true`) ' +
            'and also allows credentials (`credentials: true`), so any website can make cross-origin ' +
            'requests to the Shop and Admin APIs.',
    ];
    const sameSite = config.authOptions.cookieOptions?.sameSite;
    const cookieSentCrossSite = sameSite === 'none' || sameSite === false;
    if (tokenMethodIncludes(config.authOptions.tokenMethod, 'cookie') && cookieSentCrossSite) {
        parts.push(
            `The session cookie is configured with \`sameSite: ${JSON.stringify(sameSite)}\`, so browsers ` +
                'do attach it to cross-site requests. Any website can then act as a logged-in user and ' +
                'read the responses.',
        );
    }
    parts.push(CORS_REMEDIATION_HINT);
    parts.push('This is expected in local development. Do not deploy with it.');
    return parts.join(' ');
}

/**
 * @description
 * Returns a warning message when `apiOptions.csrfPrevention` is off and sessions are carried in a
 * cookie. Returns `undefined` otherwise.
 *
 * This is not a CORS problem, so it is reported separately. A cross-site HTML form can POST a
 * `login` mutation as a top-level navigation, which needs no CORS permission, and the response
 * sets a session cookie in the visitor's browser. Bearer-only deployments are unaffected, because
 * the browser never attaches the token by itself.
 *
 * Exported for unit testing. Production callers go through `bootstrap()`.
 */
export function getCsrfPreventionWarning(
    config: SecurityConfig,
    options: { nodeEnv?: string } = {},
): string | undefined {
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
    if (nodeEnv === 'test') {
        return undefined;
    }
    if (
        config.apiOptions.csrfPrevention === true ||
        !tokenMethodIncludes(config.authOptions.tokenMethod, 'cookie')
    ) {
        return undefined;
    }
    return (
        'Login CSRF is possible: `apiOptions.csrfPrevention` is off and sessions use cookies, so a ' +
        "cross-site HTML form can POST a `login` mutation and set a session cookie in a visitor's " +
        'browser. Set `apiOptions.csrfPrevention: true`. Check first that every client which uploads ' +
        'files to your API, or queries it over GET, sends the `Apollo-Require-Preflight` header.'
    );
}

/**
 * @description
 * Logs the messages from {@link getCorsConfigWarning} and {@link getCsrfPreventionWarning} through
 * the Vendure {@link Logger}. Called once per `bootstrap()`.
 */
export function warnAboutInsecureApiConfig(
    config: SecurityConfig,
    options: { nodeEnv?: string; logger?: Pick<typeof Logger, 'warn'> } = {},
): void {
    const logger = options.logger ?? Logger;
    for (const warning of [
        getCorsConfigWarning(config, options),
        getCsrfPreventionWarning(config, options),
    ]) {
        if (warning) {
            logger.warn(warning);
        }
    }
}
