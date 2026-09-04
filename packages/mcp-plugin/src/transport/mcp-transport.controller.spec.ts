import { UnauthorizedException } from '@nestjs/common';
import { I18nRequest } from '@vendure/core';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';

import { McpAccessTokenExpiredError } from '../oauth/oauth-error';

import { McpTransportController } from './mcp-transport.controller';

const CLIENT_IP = '203.0.113.7';
const RESOURCE_METADATA_URL = 'https://shop.example.com/.well-known/oauth-protected-resource/mcp/admin';

/**
 * Builds the controller without its Nest dependencies: the bearer-authentication path only
 * reaches the OAuth service, the rate limiter and the resource-metadata URL.
 */
function createController(authenticationError: Error) {
    const failuresRecorded: Array<string | undefined> = [];
    const headers: Record<string, string> = {};
    const controller = Object.create(McpTransportController.prototype) as McpTransportController & {
        authenticateBearerToken(
            token: string,
            toolset: 'admin' | 'shop',
            req: I18nRequest,
            res: Response,
            clientIp?: string,
        ): Promise<unknown>;
    };
    Object.assign(controller, {
        oauthService: {
            authenticateBearerToken: () => Promise.reject(authenticationError),
        },
        rateLimiter: {
            recordBearerAuthFailure: (clientIp?: string) => {
                failuresRecorded.push(clientIp);
                return Promise.resolve();
            },
        },
        oauthMetadata: {
            protectedResourceMetadataUrl: () => RESOURCE_METADATA_URL,
        },
    });
    const res = {
        setHeader: (name: string, value: string) => {
            headers[name] = value;
        },
    } as unknown as Response;
    const authenticate = () =>
        controller.authenticateBearerToken('a-token', 'admin', {} as I18nRequest, res, CLIENT_IP);
    return { authenticate, failuresRecorded, headers };
}

describe('McpTransportController bearer authentication failures', () => {
    it('charges the failure budget for a token that is not a live credential', async () => {
        const { authenticate, failuresRecorded } = createController(
            new UnauthorizedException('Access token revoked'),
        );

        await expect(authenticate()).rejects.toThrow('Access token revoked');
        expect(failuresRecorded).toEqual([CLIENT_IP]);
    });

    // A token that simply reached the end of its lifetime is answered by refreshing, so it is
    // not an authentication attempt to hold against the caller.
    it('leaves the failure budget alone for an expired access token', async () => {
        const { authenticate, failuresRecorded } = createController(new McpAccessTokenExpiredError());

        await expect(authenticate()).rejects.toThrow('Access token expired');
        expect(failuresRecorded).toEqual([]);
    });

    it('leaves a quote out of the challenge, which a header parameter cannot carry', async () => {
        const { authenticate, headers } = createController(
            new UnauthorizedException('Access token "x" revoked'),
        );

        await expect(authenticate()).rejects.toThrow();
        expect(headers['WWW-Authenticate']).toBe(
            `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token", error_description="Access token x revoked"`,
        );
    });

    it('names the reason in the WWW-Authenticate challenge', async () => {
        const { authenticate, headers } = createController(new McpAccessTokenExpiredError());

        await expect(authenticate()).rejects.toThrow();
        expect(headers['WWW-Authenticate']).toBe(
            `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token", error_description="Access token expired"`,
        );
    });
});

describe('McpTransportController bearer header parsing', () => {
    const parse = (header?: string) =>
        (McpTransportController.prototype as any).getBearerToken.call(undefined, header);

    it('returns undefined when there is no Authorization header', () => {
        expect(parse(undefined)).toBeUndefined();
    });

    it('returns undefined for the bare scheme with nothing after it', () => {
        expect(parse('Bearer')).toBeUndefined();
    });

    it('returns undefined when the scheme is not separated from what follows', () => {
        expect(parse('Bearerabc')).toBeUndefined();
    });

    it('returns undefined for a non-bearer scheme', () => {
        expect(parse('Basic abc')).toBeUndefined();
    });

    it('reads the token after the scheme', () => {
        expect(parse('Bearer abc')).toBe('abc');
    });

    it('accepts the scheme name in any case', () => {
        expect(parse('bearer abc')).toBe('abc');
    });

    it('accepts a tab between the scheme and the token', () => {
        expect(parse('Bearer\tabc')).toBe('abc');
    });

    it('skips a run of whitespace but keeps whitespace at the end', () => {
        expect(parse('Bearer  abc ')).toBe('abc ');
    });

    it('returns undefined when only whitespace follows the scheme', () => {
        expect(parse('Bearer   ')).toBeUndefined();
    });

    it('answers immediately for a long run of whitespace and no token', () => {
        const started = Date.now();
        expect(parse('Bearer ' + ' '.repeat(50_000))).toBeUndefined();
        expect(Date.now() - started).toBeLessThan(100);
    });
});
