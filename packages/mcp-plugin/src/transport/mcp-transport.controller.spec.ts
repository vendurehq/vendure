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
