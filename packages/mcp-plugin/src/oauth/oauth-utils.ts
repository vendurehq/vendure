import { ConfigService, Logger } from '@vendure/core';
import { createHash, randomBytes } from 'node:crypto';

import { loggerCtx, MAX_CLIENT_METADATA_FIELD_LENGTH } from '../constants';

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

export function assertSafeRedirectUri(redirectUri: string): void {
    let url: URL;
    try {
        url = new URL(redirectUri);
    } catch {
        throw new McpOauthError('invalid_redirect_uri', 'redirect_uri must be an absolute URL');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
        throw new McpOauthError('invalid_redirect_uri', 'redirect_uri must use HTTPS or localhost HTTP');
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
