import { BadRequestException } from '@nestjs/common';

import { MAX_CLIENT_METADATA_FIELD_LENGTH, SUPPORTED_OAUTH_GRANT_TYPES } from '../../constants';
import { assertSafeRedirectUri, httpsUrlOrNull } from '../oauth-utils';

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
    if ('client_secret' in document || 'client_secret_expires_at' in document) {
        throw new BadRequestException('client_id metadata document must not contain a client secret');
    }
    const declaredMethod = document.token_endpoint_auth_method ?? 'none';
    const supportedMethods = Array.isArray(document.token_endpoint_auth_methods_supported)
        ? document.token_endpoint_auth_methods_supported
        : [];
    if (declaredMethod !== 'none' && !supportedMethods.includes('none')) {
        throw new BadRequestException(
            'client_id metadata document must support token_endpoint_auth_method "none"',
        );
    }
    // A document may list grant types meant for other servers too, so only keep the ones we support.
    const declaredGrantTypes = Array.isArray(document.grant_types)
        ? document.grant_types.filter((grant): grant is string => typeof grant === 'string')
        : SUPPORTED_OAUTH_GRANT_TYPES;
    const grantTypes = declaredGrantTypes.filter(grant => SUPPORTED_OAUTH_GRANT_TYPES.includes(grant));
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
