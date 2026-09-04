import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';

import { CIMD_MAX_CLIENT_ID_LENGTH } from '../../constants';
import { isLoopbackHostname } from '../loopback';

// Client ID Metadata Documents (CIMD, draft-ietf-oauth-client-id-metadata-document-02):
// a client_id that is an HTTPS URL pointing at a JSON document describing the client,
// instead of an id created by registration. This module owns the URL-shape rules (§3).

/**
 * Returns true if the clientId is URL-shaped (CIMD), otherwise it is treated
 * as a registered client identifier.
 */
export function isUrlClientId(clientId: string): boolean {
    // URL scheme is case-insensitive; normalization is handled by validation layer.
    const scheme = clientId.slice(0, 8).toLowerCase();
    return scheme.startsWith('https://') || scheme.startsWith('http://');
}

export interface CimdClientIdUrlOptions {
    // Allow loopback HTTP/HTTPS URLs (development only).
    allowLoopback: boolean;
}

/**
 * Enforces HTTPS (with optional loopback exception), rejects unsafe URL forms,
 * and ensures the value matches canonical URL parsing rules.
 */
export function validateCimdClientIdUrl(clientId: string, options: CimdClientIdUrlOptions): URL {
    if (clientId.length > CIMD_MAX_CLIENT_ID_LENGTH) {
        throw new BadRequestException(
            `client_id URL must be at most ${CIMD_MAX_CLIENT_ID_LENGTH} characters`,
        );
    }
    let url: URL;
    try {
        url = new URL(clientId);
    } catch {
        throw new BadRequestException('client_id is not a valid URL');
    }
    const loopback = isLoopbackHostname(url.hostname);
    const httpLoopbackAllowed = options.allowLoopback && url.protocol === 'http:' && loopback;
    if (url.protocol !== 'https:' && !httpLoopbackAllowed) {
        throw new BadRequestException('client_id URL must use https');
    }
    if (loopback && !options.allowLoopback) {
        throw new BadRequestException('client_id URL must not point at a loopback address');
    }
    if (url.username || url.password) {
        throw new BadRequestException('client_id URL must not contain userinfo');
    }
    if (url.hash) {
        throw new BadRequestException('client_id URL must not contain a fragment');
    }
    if (url.search || clientId.includes('?')) {
        throw new BadRequestException('client_id URL must not contain a query string');
    }
    if (url.pathname === '/') {
        throw new BadRequestException(
            'client_id URL must include a path, for example /oauth-client-metadata.json',
        );
    }
    // The WHATWG URL parser resolves "." and ".." segments silently, so inspect the raw
    // string: the document's client_id must equal this exact string, and the draft forbids
    // dot segments outright.
    for (const segment of clientId.split('/')) {
        const normalized = segment.toLowerCase().replace(/%2e/g, '.');
        if (normalized === '.' || normalized === '..') {
            throw new BadRequestException('client_id URL must not contain dot path segments');
        }
    }
    const bareHost = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(bareHost) !== 0 && !(options.allowLoopback && loopback)) {
        throw new BadRequestException('client_id URL must use a hostname, not an IP address');
    }
    // Last: the string must survive parsing unchanged. The parser rewrites a URL in ways
    // the checks above cannot see, such as resolving "." and ".." segments and treating
    // "\" as a path separator.
    if (url.href !== clientId) {
        throw new BadRequestException(
            `client_id URL must be given in canonical form (${url.href}), not "${clientId}"`,
        );
    }
    return url;
}
