import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';

import { CIMD_MAX_CLIENT_ID_LENGTH } from '../../constants';
import { isLoopbackHostname } from '../loopback';

// Client ID Metadata Documents (CIMD, draft-ietf-oauth-client-id-metadata-document-02):
// a client_id that is an HTTPS URL pointing at a JSON document describing the client,
// instead of an id created by registration. This module owns the URL-shape rules (§3).

export function isUrlClientId(clientId: string): boolean {
    // URL scheme is case-insensitive; normalization is handled by validation layer.
    const scheme = clientId.slice(0, 8).toLowerCase();
    return scheme.startsWith('https://') || scheme.startsWith('http://');
}

export interface CimdClientIdUrlOptions {
    // Allow loopback HTTP/HTTPS URLs (development only).
    allowLoopback: boolean;
}

export function validateCimdClientIdUrl(clientId: string, options: CimdClientIdUrlOptions): URL {
    assertWithinLengthLimit(clientId);
    const url = parseClientIdUrl(clientId);
    const loopback = isLoopbackHostname(url.hostname);
    assertSchemeAllowed(url, loopback, options);
    assertNoUserinfo(url);
    assertNoFragment(url);
    assertNoQueryString(url, clientId);
    assertHasPath(url);
    assertNoDotSegments(clientId);
    assertHostnameIsNotIpAddress(url, loopback, options);
    assertCanonicalForm(url, clientId);
    return url;
}

function assertWithinLengthLimit(clientId: string): void {
    if (clientId.length > CIMD_MAX_CLIENT_ID_LENGTH) {
        throw new BadRequestException(
            `client_id URL must be at most ${CIMD_MAX_CLIENT_ID_LENGTH} characters`,
        );
    }
}

function parseClientIdUrl(clientId: string): URL {
    try {
        return new URL(clientId);
    } catch {
        throw new BadRequestException('client_id is not a valid URL');
    }
}

function assertSchemeAllowed(url: URL, loopback: boolean, options: CimdClientIdUrlOptions): void {
    const httpLoopbackAllowed = options.allowLoopback && url.protocol === 'http:' && loopback;
    if (url.protocol !== 'https:' && !httpLoopbackAllowed) {
        throw new BadRequestException('client_id URL must use https');
    }
    if (loopback && !options.allowLoopback) {
        throw new BadRequestException('client_id URL must not point at a loopback address');
    }
}

function assertNoUserinfo(url: URL): void {
    if (url.username || url.password) {
        throw new BadRequestException('client_id URL must not contain userinfo');
    }
}

function assertNoFragment(url: URL): void {
    if (url.hash) {
        throw new BadRequestException('client_id URL must not contain a fragment');
    }
}

function assertNoQueryString(url: URL, clientId: string): void {
    if (url.search || clientId.includes('?')) {
        throw new BadRequestException('client_id URL must not contain a query string');
    }
}

function assertHasPath(url: URL): void {
    if (url.pathname === '/') {
        throw new BadRequestException(
            'client_id URL must include a path, for example /oauth-client-metadata.json',
        );
    }
}

/** The URL parser resolves "." and ".." segments silently, so check the raw string instead. */
function assertNoDotSegments(clientId: string): void {
    for (const segment of clientId.split('/')) {
        const normalized = segment.toLowerCase().replace(/%2e/g, '.');
        if (normalized === '.' || normalized === '..') {
            throw new BadRequestException('client_id URL must not contain dot path segments');
        }
    }
}

function assertHostnameIsNotIpAddress(url: URL, loopback: boolean, options: CimdClientIdUrlOptions): void {
    const bareHost = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(bareHost) !== 0 && !(options.allowLoopback && loopback)) {
        throw new BadRequestException('client_id URL must use a hostname, not an IP address');
    }
}

/** Catches parser rewrites the other checks can't see, such as resolving "." and ".." segments. */
function assertCanonicalForm(url: URL, clientId: string): void {
    if (url.href !== clientId) {
        throw new BadRequestException(
            `client_id URL must be given in canonical form (${url.href}), not "${clientId}"`,
        );
    }
}
