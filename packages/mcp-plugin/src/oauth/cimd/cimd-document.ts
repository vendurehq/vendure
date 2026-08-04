import { BadRequestException } from '@nestjs/common';

import { MAX_CLIENT_METADATA_FIELD_LENGTH } from '../../constants';
import { assertSafeRedirectUri } from '../oauth-utils';

/** The subset of a fetched CIMD document that this authorization server stores. */
export interface CimdDocument {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    clientUri: string | null;
    logoUri: string | null;
    grantTypes: string[];
    tokenEndpointAuthMethod: 'none';
}

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];

/**
 * Parses and validates a fetched client metadata document (draft §4/§4.1 plus the MCP
 * client-registration page's required fields). `clientId` is the exact client_id string
 * from the authorization request; the document's own client_id must equal it byte for
 * byte — no normalization (draft: simple string comparison).
 */
export function parseCimdDocument(clientId: string, rawBody: string): CimdDocument {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        throw new BadRequestException('client_id metadata document is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new BadRequestException('client_id metadata document must be a JSON object');
    }
    const document = parsed as Record<string, unknown>;
    if (document.client_id !== clientId) {
        throw new BadRequestException(
            'client_id metadata document client_id must exactly match the client_id URL',
        );
    }
    if (typeof document.client_name !== 'string' || document.client_name.length === 0) {
        throw new BadRequestException('client_id metadata document must include client_name');
    }
    if (document.client_name.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
        throw new BadRequestException(
            `client_id metadata document client_name must be at most ${MAX_CLIENT_METADATA_FIELD_LENGTH} characters`,
        );
    }
    const redirectUris = document.redirect_uris;
    if (
        !Array.isArray(redirectUris) ||
        redirectUris.length === 0 ||
        !redirectUris.every(uri => typeof uri === 'string')
    ) {
        throw new BadRequestException('client_id metadata document must include redirect_uris');
    }
    for (const uri of redirectUris) {
        assertSafeRedirectUri(uri);
    }
    // Draft §4.1: the document is public by definition, so it cannot carry a shared secret
    // and no shared-secret token auth method is usable. This server additionally rejects
    // private_key_jwt because it only supports "none" (see metadata()).
    if ('client_secret' in document || 'client_secret_expires_at' in document) {
        throw new BadRequestException('client_id metadata document must not contain a client secret');
    }
    const authMethod = document.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') {
        throw new BadRequestException(
            'client_id metadata document must use token_endpoint_auth_method "none"',
        );
    }
    // A CIMD document is portable across authorization servers, so it may list grant types
    // other servers support. Keep the intersection, but the grant this flow runs on must
    // be there.
    const declaredGrantTypes = Array.isArray(document.grant_types)
        ? document.grant_types.filter((grant): grant is string => typeof grant === 'string')
        : SUPPORTED_GRANT_TYPES;
    const grantTypes = declaredGrantTypes.filter(grant => SUPPORTED_GRANT_TYPES.includes(grant));
    if (!grantTypes.includes('authorization_code')) {
        throw new BadRequestException('client_id metadata document must allow the authorization_code grant');
    }
    return {
        clientId,
        clientName: document.client_name,
        redirectUris,
        clientUri: httpsUrlOrNull(document.client_uri),
        logoUri: httpsUrlOrNull(document.logo_uri),
        grantTypes,
        tokenEndpointAuthMethod: 'none',
    };
}

/**
 * Keeps a display-URL field only when it is a well-formed https URL that fits its column; display
 * data is dropped, not fatal.
 */
function httpsUrlOrNull(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
        return null;
    }
    try {
        return new URL(value).protocol === 'https:' ? value : null;
    } catch {
        return null;
    }
}
