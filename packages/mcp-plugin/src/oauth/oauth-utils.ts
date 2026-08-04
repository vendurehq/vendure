import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { isLoopbackHostname } from './loopback';

/**
 * Generates a cryptographically random, URL-safe token encoded as base64url
 * (no padding characters). Use this to create authorization codes, state
 * parameters, and other short-lived OAuth values that are transmitted over
 * the wire.
 */
export function randomToken(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url');
}

/**
 * Returns a new `Date` that is `seconds` seconds after `date`. Used to
 * compute expiry timestamps for tokens and authorization codes.
 */
export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}

/**
 * Verifies a PKCE code verifier against a previously stored code challenge.
 * Only the `S256` method is supported: the verifier is SHA-256 hashed and
 * base64url-encoded, then compared to the challenge. Returns `false` for any
 * unsupported method or when the values do not match.
 */
export function verifyPkceChallenge(verifier: string, challenge: string, method = 'S256'): boolean {
    if (method !== 'S256') {
        return false;
    }
    const digest = createHash('sha256').update(verifier).digest('base64url');
    return digest === challenge;
}

/**
 * Appends OAuth query parameters to a redirect URI. Parameters with an
 * `undefined` value are omitted. Any query parameters already present in
 * `redirectUri` are preserved.
 */
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
 * A redirect_uri must be HTTPS, or plain HTTP only on a loopback host (native and CLI
 * clients listen there). Applied to DCR registrations and to the redirect_uris inside
 * CIMD client metadata documents.
 */
export function assertSafeRedirectUri(redirectUri: string): void {
    let url: URL;
    try {
        url = new URL(redirectUri);
    } catch {
        throw new BadRequestException('redirect_uri must be an absolute URL');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
        throw new BadRequestException('redirect_uri must use HTTPS or localhost HTTP');
    }
}
