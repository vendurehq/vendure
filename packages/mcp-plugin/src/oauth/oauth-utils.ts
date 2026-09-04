import { ConfigService, Logger } from '@vendure/core';
import { createHash, randomBytes } from 'node:crypto';

import { loggerCtx, MAX_CLIENT_METADATA_FIELD_LENGTH } from '../constants';
import { McpOauthOptionsWithDefaults, ResolvedMcpPluginOptions } from '../internal-types';

import { isLoopbackHostname } from './loopback';
import { McpOauthError } from './oauth-error';

export function randomToken(): string {
    return randomBytes(32).toString('base64url');
}

export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}

/**
 * Verifies a PKCE S256 code verifier against its stored challenge.
 */
export function verifyPkceChallenge(verifier: string, challenge: string): boolean {
    const digest = createHash('sha256').update(verifier).digest('base64url');
    return digest === challenge;
}

export function appendOAuthParams(redirectUri: string, params: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
        if (value != null) {
            url.searchParams.set(key, value);
        }
    }
    return url.toString();
}

/**
 * Schemes a browser could execute or that reach the local filesystem. Everything else that is
 * not http(s) is treated as a native app's private-use scheme (RFC 8252), e.g.
 * `cursor://anysphere.cursor-mcp/oauth/callback` — the OS hands those to the installed app.
 */
const FORBIDDEN_REDIRECT_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:']);

export function assertSafeRedirectUri(redirectUri: string): void {
    let url: URL;
    try {
        url = new URL(redirectUri);
    } catch {
        throw new McpOauthError('invalid_redirect_uri', 'redirect_uri must be an absolute URL');
    }
    if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
        throw new McpOauthError('invalid_redirect_uri', 'redirect_uri may only use HTTP on localhost');
    }
    if (FORBIDDEN_REDIRECT_SCHEMES.has(url.protocol.toLowerCase())) {
        throw new McpOauthError(
            'invalid_redirect_uri',
            `redirect_uri must not use the ${url.protocol} scheme`,
        );
    }
    if (redirectUri.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
        throw new McpOauthError(
            'invalid_redirect_uri',
            `redirect_uri must be at most ${MAX_CLIENT_METADATA_FIELD_LENGTH} characters`,
        );
    }
}

export function httpsUrlOrNull(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
        return null;
    }
    try {
        return new URL(value).protocol === 'https:' ? value : null;
    } catch {
        return null;
    }
}

export async function deleteCachedVendureSession(
    configService: ConfigService,
    token: string | undefined,
): Promise<void> {
    if (!token) return;

    try {
        await configService.authOptions.sessionCacheStrategy.delete(token);
    } catch (error) {
        Logger.error(
            'Failed to evict a deleted MCP session from the session cache',
            loggerCtx,
            error instanceof Error ? error.stack : undefined,
        );
    }
}

/** The OAuth options with defaults applied and the issuer known. */
export type McpOauthOptionsWithIssuer = McpOauthOptionsWithDefaults & { issuer: string };

/**
 * Returns the resolved OAuth options, throwing if OAuth was not configured
 * (i.e. no `oauth.tokenSecret` was supplied to the plugin).
 */
export function resolvedOauthOptions(options: ResolvedMcpPluginOptions): McpOauthOptionsWithIssuer {
    if (!options.oauth?.tokenSecret) {
        throw new McpOauthError(
            'server_error',
            'MCP OAuth is not configured (oauth.tokenSecret is required)',
        );
    }
    // The plugin's configuration hook sets oauth.issuer at boot when the user left it out, so by
    // the time any request arrives it is always a string.
    return options.oauth as McpOauthOptionsWithIssuer;
}
