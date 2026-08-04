import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';

import { CIMD_MAX_CLIENT_ID_LENGTH } from '../../constants';
import { isLoopbackHostname } from '../loopback';

// Client ID Metadata Documents (CIMD, draft-ietf-oauth-client-id-metadata-document-02):
// a client_id that is an HTTPS URL pointing at a JSON document describing the client,
// instead of an id created by registration. This module owns the URL-shape rules (§3).

/**
 * Branch test used by the OAuth service: a client_id that starts with a URL scheme is
 * resolved as a CIMD URL; anything else is looked up as a registered client id.
 * Registered ids are server-generated base64url tokens, so the two cannot collide.
 */
export function isUrlClientId(clientId: string): boolean {
    // Scheme casing is not significant in a URL, so `HTTPS://…` is recognised here and then
    // refused by the canonical-form rule below, which reports the form to use. Left to the
    // registered-id lookup it would only ever produce "unknown client".
    const scheme = clientId.slice(0, 8).toLowerCase();
    return scheme.startsWith('https://') || scheme.startsWith('http://');
}

export interface CimdClientIdUrlOptions {
    /**
     * Permit plain-HTTP and loopback client_id URLs. The draft (§8.6) allows a loopback
     * exception for development only; production servers must never enable this.
     */
    allowLoopback: boolean;
}

/**
 * Validates the shape of a CIMD client_id URL (draft §3): https scheme, a non-root path,
 * no userinfo, no query string, no fragment, no dot path segments, and a hostname rather
 * than an IP address. Returns the parsed URL; throws BadRequestException on any violation.
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
    // Last: the string must survive parsing unchanged. The parser rewrites a URL in ways the
    // checks above cannot see — it resolves "." and ".." segments, treats "\" as a path
    // separator etc...
    if (url.href !== clientId) {
        throw new BadRequestException(
            `client_id URL must be given in canonical form (${url.href}), not "${clientId}"`,
        );
    }
    return url;
}
