import { describe, expect, it } from 'vitest';

import { parseCimdDocument } from './cimd-document';

const CLIENT_ID = 'https://client.example.com/oauth-client-metadata.json';

function doc(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        client_id: CLIENT_ID,
        client_name: 'Example MCP Client',
        redirect_uris: ['https://client.example.com/callback', 'http://127.0.0.1:3000/cb'],
        ...overrides,
    });
}

describe('parseCimdDocument', () => {
    it('accepts a minimal valid document', () => {
        const parsed = parseCimdDocument(CLIENT_ID, doc());
        expect(parsed.clientName).toBe('Example MCP Client');
        expect(parsed.redirectUris).toEqual([
            'https://client.example.com/callback',
            'http://127.0.0.1:3000/cb',
        ]);
        expect(parsed.tokenEndpointAuthMethod).toBe('none');
        expect(parsed.grantTypes).toEqual(['authorization_code', 'refresh_token']);
    });

    it('rejects bodies that are not JSON objects', () => {
        expect(() => parseCimdDocument(CLIENT_ID, 'not json')).toThrow('not valid JSON');
        expect(() => parseCimdDocument(CLIENT_ID, '[1,2]')).toThrow('must be a JSON object');
    });

    it('rejects a client_id that does not exactly match the URL', () => {
        expect(() =>
            parseCimdDocument(CLIENT_ID, doc({ client_id: 'https://client.example.com/other.json' })),
        ).toThrow('must exactly match');
        // Even a case difference is a mismatch: comparison is byte-for-byte.
        expect(() => parseCimdDocument(CLIENT_ID, doc({ client_id: CLIENT_ID.toUpperCase() }))).toThrow(
            'must exactly match',
        );
    });

    it('rejects a missing client_name', () => {
        expect(() => parseCimdDocument(CLIENT_ID, doc({ client_name: undefined }))).toThrow('client_name');
    });

    // Long values must fail validation rather than the database insert, which would be an
    // opaque server error instead of a 400 (MySQL varchar columns default to 255 characters).
    it('rejects an over-long client_name and drops an over-long client_uri', () => {
        expect(() => parseCimdDocument(CLIENT_ID, doc({ client_name: 'n'.repeat(256) }))).toThrow(
            'at most 255 characters',
        );
        const parsed = parseCimdDocument(
            CLIENT_ID,
            doc({ client_uri: `https://client.example.com/${'a'.repeat(260)}` }),
        );
        expect(parsed.clientUri).toBeNull();
    });

    it('rejects missing or empty redirect_uris', () => {
        expect(() => parseCimdDocument(CLIENT_ID, doc({ redirect_uris: undefined }))).toThrow(
            'redirect_uris',
        );
        expect(() => parseCimdDocument(CLIENT_ID, doc({ redirect_uris: [] }))).toThrow('redirect_uris');
    });

    it('rejects redirect_uris that are neither https nor loopback http', () => {
        expect(() =>
            parseCimdDocument(CLIENT_ID, doc({ redirect_uris: ['http://evil.example.com/cb'] })),
        ).toThrow('redirect_uri must use HTTPS or localhost HTTP');
    });

    it('rejects documents carrying a client secret', () => {
        expect(() => parseCimdDocument(CLIENT_ID, doc({ client_secret: 'shh' }))).toThrow('client secret');
    });

    it('rejects any token_endpoint_auth_method other than none', () => {
        for (const method of ['client_secret_basic', 'client_secret_post', 'private_key_jwt']) {
            expect(() => parseCimdDocument(CLIENT_ID, doc({ token_endpoint_auth_method: method }))).toThrow(
                'token_endpoint_auth_method',
            );
        }
        expect(() => parseCimdDocument(CLIENT_ID, doc({ token_endpoint_auth_method: 'none' }))).not.toThrow();
    });

    it('keeps only the grant types this server supports and requires authorization_code', () => {
        const parsed = parseCimdDocument(
            CLIENT_ID,
            doc({ grant_types: ['authorization_code', 'client_credentials'] }),
        );
        expect(parsed.grantTypes).toEqual(['authorization_code']);
        expect(() => parseCimdDocument(CLIENT_ID, doc({ grant_types: ['implicit'] }))).toThrow(
            'authorization_code',
        );
    });

    it('drops client_uri and logo_uri unless they are well-formed https URLs', () => {
        const parsed = parseCimdDocument(
            CLIENT_ID,
            doc({ client_uri: 'javascript:alert(1)', logo_uri: 'https://client.example.com/logo.png' }),
        );
        expect(parsed.clientUri).toBeNull();
        expect(parsed.logoUri).toBe('https://client.example.com/logo.png');
    });
});
