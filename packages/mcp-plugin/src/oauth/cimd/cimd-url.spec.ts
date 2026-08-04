import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { isUrlClientId, validateCimdClientIdUrl } from './cimd-url';

const strict = { allowLoopback: false };
const dev = { allowLoopback: true };

describe('isUrlClientId', () => {
    it('treats https and http values as URL client_ids', () => {
        expect(isUrlClientId('https://client.example.com/metadata.json')).toBe(true);
        expect(isUrlClientId('http://127.0.0.1:8080/metadata.json')).toBe(true);
    });

    it('treats registered random ids as non-URL client_ids', () => {
        expect(isUrlClientId('aGVsbG8td29ybGQ')).toBe(false);
    });

    // Recognised here so the canonical-form rule can name the form to use, rather than the
    // registered-id lookup reporting an unknown client.
    it('recognises an upper-case scheme', () => {
        expect(isUrlClientId('HTTPS://client.example.com/metadata.json')).toBe(true);
        expect(() => validateCimdClientIdUrl('HTTPS://client.example.com/metadata.json', strict)).toThrow(
            'canonical form',
        );
    });
});

describe('validateCimdClientIdUrl', () => {
    it('accepts a well-formed https client_id URL', () => {
        const url = validateCimdClientIdUrl('https://client.example.com/oauth/metadata.json', strict);
        expect(url.hostname).toBe('client.example.com');
    });

    it('accepts a port', () => {
        expect(() =>
            validateCimdClientIdUrl('https://client.example.com:8443/metadata.json', strict),
        ).not.toThrow();
    });

    it('rejects plain http on a public host, even in development mode', () => {
        expect(() => validateCimdClientIdUrl('http://client.example.com/m.json', dev)).toThrow(
            BadRequestException,
        );
    });

    it('accepts http on a loopback host only in development mode', () => {
        expect(() => validateCimdClientIdUrl('http://127.0.0.1:9000/m.json', dev)).not.toThrow();
        expect(() => validateCimdClientIdUrl('http://127.0.0.1:9000/m.json', strict)).toThrow(
            BadRequestException,
        );
    });

    it('rejects loopback hostnames in production mode regardless of scheme', () => {
        expect(() => validateCimdClientIdUrl('https://localhost/m.json', strict)).toThrow(
            BadRequestException,
        );
    });

    it('rejects userinfo', () => {
        expect(() => validateCimdClientIdUrl('https://user:pw@client.example.com/m.json', strict)).toThrow(
            'client_id URL must not contain userinfo',
        );
    });

    it('rejects fragments', () => {
        expect(() => validateCimdClientIdUrl('https://client.example.com/m.json#frag', strict)).toThrow(
            'client_id URL must not contain a fragment',
        );
    });

    it('rejects query strings', () => {
        expect(() => validateCimdClientIdUrl('https://client.example.com/m.json?u=1', strict)).toThrow(
            'client_id URL must not contain a query string',
        );
        expect(() => validateCimdClientIdUrl('https://client.example.com/m.json?', strict)).toThrow(
            'client_id URL must not contain a query string',
        );
    });

    it('rejects a missing or root-only path', () => {
        expect(() => validateCimdClientIdUrl('https://client.example.com', strict)).toThrow(
            BadRequestException,
        );
        expect(() => validateCimdClientIdUrl('https://client.example.com/', strict)).toThrow(
            BadRequestException,
        );
    });

    it('rejects dot path segments, including percent-encoded ones', () => {
        expect(() => validateCimdClientIdUrl('https://client.example.com/a/../m.json', strict)).toThrow(
            'client_id URL must not contain dot path segments',
        );
        expect(() => validateCimdClientIdUrl('https://client.example.com/./m.json', strict)).toThrow(
            'client_id URL must not contain dot path segments',
        );
        expect(() => validateCimdClientIdUrl('https://client.example.com/%2e%2E/m.json', strict)).toThrow(
            'client_id URL must not contain dot path segments',
        );
    });

    // The URL parser rewrites these silently, so without a canonical-form check the server
    // would fetch one address while recording and displaying another.
    it('rejects a URL the parser would rewrite', () => {
        const rewritten = [
            'https://client.example.com/a\\..\\b.json', // backslash acts as a path separator
            'https://client.example.com/a\tb.json', // tab is stripped
            'https://Client.Example.COM/m.json', // host is lowercased
            'https://client.example.com:443/m.json', // default port is dropped
        ];
        for (const clientId of rewritten) {
            expect(() => validateCimdClientIdUrl(clientId, strict)).toThrow('canonical form');
        }
    });

    it('rejects an over-long client_id URL', () => {
        const tooLong = `https://client.example.com/${'a'.repeat(520)}.json`;
        expect(() => validateCimdClientIdUrl(tooLong, strict)).toThrow('at most 512 characters');
    });

    it('rejects IP-literal hosts', () => {
        expect(() => validateCimdClientIdUrl('https://192.0.2.10/m.json', strict)).toThrow(
            'client_id URL must use a hostname, not an IP address',
        );
        expect(() => validateCimdClientIdUrl('https://[2001:db8::1]/m.json', strict)).toThrow(
            'client_id URL must use a hostname, not an IP address',
        );
    });

    it('rejects values that are not URLs at all', () => {
        expect(() => validateCimdClientIdUrl('https://', strict)).toThrow(BadRequestException);
    });
});
