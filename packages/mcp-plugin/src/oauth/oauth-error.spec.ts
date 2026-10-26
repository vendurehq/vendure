import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { Logger } from '@vendure/core';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpOauthError, McpOauthExceptionFilter } from './oauth-error';

/** Captures what the filter writes: the status, the JSON body and the headers it sets. */
function createHost() {
    const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const res = {
        setHeader: (name: string, value: string) => {
            sent.headers[name] = value;
        },
        status: (status: number) => {
            sent.status = status;
            return { json: (body: unknown) => (sent.body = body) };
        },
    } as unknown as Response;
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as ArgumentsHost;
    return { host, sent };
}

describe('McpOauthExceptionFilter', () => {
    const filter = new McpOauthExceptionFilter();

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends an OAuth error as it was raised', () => {
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const { host, sent } = createHost();

        filter.catch(new McpOauthError('invalid_grant', 'Refresh token invalid or expired'), host);

        expect(sent.status).toBe(400);
        expect(sent.body).toEqual({
            error: 'invalid_grant',
            error_description: 'Refresh token invalid or expired',
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it('converts any other bad request to an OAuth error body and logs it', () => {
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const { host, sent } = createHost();

        filter.catch(new BadRequestException('redirect_uri is not registered for this client'), host);

        expect(sent.status).toBe(400);
        expect(sent.body).toEqual({
            error: 'invalid_request',
            error_description: 'redirect_uri is not registered for this client',
        });
        expect(warn).toHaveBeenCalledWith(
            'OAuth request rejected: redirect_uri is not registered for this client',
            'McpPlugin',
        );
    });

    it('keeps the OAuth responses out of caches', () => {
        vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const { host, sent } = createHost();

        filter.catch(new BadRequestException('nope'), host);

        expect(sent.headers).toEqual({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    });
});
