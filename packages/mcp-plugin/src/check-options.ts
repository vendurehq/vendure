import { Logger } from '@vendure/core';

import { loggerCtx } from './constants';
import { McpOauthOptionsWithDefaults, ResolvedMcpPluginOptions } from './internal-types';
import { isLoopbackHostname } from './oauth/loopback';

/**
 * @description
 * Checks the resolved plugin options at startup: warns about settings that only matter on a real
 * deployment, and throws when an OAuth option is shaped in a way nothing can work with.
 */
export function checkMcpPluginOptions(options: ResolvedMcpPluginOptions): void {
    const logging = options.logging;
    if (logging.capture === 'full' && !logging.redact) {
        Logger.warn(
            'Full MCP logging is enabled without redaction. ' +
                'This may store sensitive data. Add logging.redact to sanitize logs, ' +
                'or switch to metadata-only logging.',
            loggerCtx,
        );
    }
    // Without an allowlist the endpoints answer any Host and Origin, which is what lets a
    // page in a browser reach a server it should not.
    const dnsRebinding = options.dnsRebinding;
    if (
        process.env.NODE_ENV === 'production' &&
        !dnsRebinding?.allowedHosts?.length &&
        !dnsRebinding?.allowedOrigins?.length
    ) {
        Logger.warn(
            'dnsRebinding is not set, so the MCP endpoints accept any Host and Origin header. ' +
                'Set dnsRebinding.allowedHosts and dnsRebinding.allowedOrigins for a server that ' +
                'browsers can reach.',
            loggerCtx,
        );
    }
    const oauth = options.oauth;
    if (!oauth) {
        return;
    }
    assertOauthShape(oauth);

    // The same three tiers core uses for its superadmin credential check: production refuses to
    // start, tests stay silent, and every other environment gets a warning.
    const problems = collectProductionSafetyProblems(oauth);
    if (process.env.NODE_ENV === 'production') {
        if (problems.length) {
            throw new Error(`McpPlugin: ${problems[0]}`);
        }
    } else if (process.env.NODE_ENV !== 'test') {
        for (const problem of problems) {
            Logger.warn(`Unsafe for production: ${problem}`, loggerCtx);
        }
    }
}

/** The OAuth options that cannot work in any environment, so they are refused everywhere. */
function assertOauthShape(oauth: McpOauthOptionsWithDefaults): void {
    if (!oauth.tokenSecret) {
        throw new Error(
            'McpPlugin: oauth.tokenSecret must be set to a non-empty secret string, because issued OAuth tokens are hashed with it.',
        );
    }
    const issuer = oauth.issuer ?? '';
    let issuerUrl: URL;
    try {
        issuerUrl = new URL(issuer);
    } catch {
        throw issuerError(issuer);
    }
    if (issuerUrl.pathname !== '/' || issuerUrl.search || issuerUrl.hash) {
        throw issuerError(issuer);
    }
    if (!staysOnIssuer(oauth.adminConsentPath, issuerUrl)) {
        throw new Error(
            `McpPlugin: oauth.adminConsentPath "${oauth.adminConsentPath}" must be a path on ` +
                `oauth.issuer, such as "/dashboard/mcp/authorize".`,
        );
    }
    if (oauth.storefrontConsentUrl) {
        try {
            new URL(oauth.storefrontConsentUrl);
        } catch {
            throw new Error(
                `McpPlugin: oauth.storefrontConsentUrl must be a full URL with a scheme, such as ` +
                    `"https://shop.example.com/mcp/authorize", got "${oauth.storefrontConsentUrl}".`,
            );
        }
    }
}

function issuerError(issuer: string): Error {
    return new Error(
        `McpPlugin: oauth.issuer must be a URL with a scheme and no path, such as ` +
            `"https://example.com", got "${issuer}".`,
    );
}

/**
 * The admin consent page is served by the Vendure server itself. Forms such as "//host/x" and
 * "/\\host/x" resolve to another host, which is why the origin is compared rather than the text.
 */
function staysOnIssuer(path: string, issuerUrl: URL): boolean {
    try {
        return new URL(path, issuerUrl).origin === issuerUrl.origin;
    } catch {
        return false;
    }
}

/** The OAuth settings that a production server must not run with, as messages. */
function collectProductionSafetyProblems(oauth: McpOauthOptionsWithDefaults): string[] {
    const problems: string[] = [];
    if (oauth.allowLoopbackCimdDocuments) {
        problems.push(
            `oauth.allowLoopbackCimdDocuments must be false in production; it lets any authorize ` +
                `caller reach every port on this machine.`,
        );
    }
    const issuerProblem = publicHttpsProblem('oauth.issuer', oauth.issuer ?? '');
    if (issuerProblem) {
        problems.push(issuerProblem);
    }
    if (oauth.storefrontConsentUrl) {
        const consentProblem = publicHttpsProblem('oauth.storefrontConsentUrl', oauth.storefrontConsentUrl);
        if (consentProblem) {
            problems.push(consentProblem);
        }
    }
    return problems;
}

/** Names a URL option that clients on the public internet could not reach, or use safely. */
function publicHttpsProblem(name: string, url: string): string | undefined {
    let parsed: URL | undefined;
    try {
        parsed = new URL(url);
    } catch {
        // Not a URL at all, so not a public address either.
    }
    if (parsed?.protocol !== 'https:' || isLoopbackHostname(parsed.hostname)) {
        return `${name} must be a public https URL in production, got "${url}".`;
    }
    return undefined;
}
