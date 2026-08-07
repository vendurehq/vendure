import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
    McpOauthRateLimitExceededHttpException,
    McpOauthRateLimitExceptionFilter,
    McpOauthRateLimitGuard,
} from './mcp-oauth-rate-limit.guard';
import { McpRateLimitExceededError } from './mcp-rate-limiter.service';

/** A fake Nest ExecutionContext/ArgumentsHost exposing just the request/response the guard/filter read. */
function fakeHost(
    req: { ip?: string },
    res: {
        setHeader: ReturnType<typeof vi.fn>;
        status: ReturnType<typeof vi.fn>;
        json: ReturnType<typeof vi.fn>;
    },
) {
    return {
        switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => res,
        }),
    } as any;
}

function fakeResponse() {
    const res: any = { setHeader: vi.fn(), json: vi.fn() };
    res.status = vi.fn().mockReturnValue(res);
    return res;
}

describe('McpOauthRateLimitGuard', () => {
    it('passes the request through when the limiter allows it', async () => {
        const rateLimiter = { enforceOauthIpRateLimit: vi.fn().mockResolvedValue(undefined) };
        const guard = new McpOauthRateLimitGuard(rateLimiter as any);

        await expect(guard.canActivate(fakeHost({ ip: '1.2.3.4' }, fakeResponse()))).resolves.toBe(true);
        expect(rateLimiter.enforceOauthIpRateLimit).toHaveBeenCalledWith('1.2.3.4');
    });

    it('throws McpOauthRateLimitExceededHttpException carrying the retry-after seconds', async () => {
        const rateLimiter = {
            enforceOauthIpRateLimit: vi.fn().mockRejectedValue(
                new McpRateLimitExceededError({
                    message: 'Rate limit exceeded',
                    retryAfterSeconds: 7,
                    scope: 'OAuth IP',
                    subject: 'MCP OAuth request',
                }),
            ),
        };
        const guard = new McpOauthRateLimitGuard(rateLimiter as any);

        const call = guard.canActivate(fakeHost({ ip: '1.2.3.4' }, fakeResponse()));
        await expect(call).rejects.toBeInstanceOf(McpOauthRateLimitExceededHttpException);
        await expect(call).rejects.toMatchObject({ retryAfterSeconds: 7 });
    });

    it('rethrows any other error unchanged', async () => {
        const boom = new Error('boom');
        const rateLimiter = { enforceOauthIpRateLimit: vi.fn().mockRejectedValue(boom) };
        const guard = new McpOauthRateLimitGuard(rateLimiter as any);

        await expect(guard.canActivate(fakeHost({ ip: '1.2.3.4' }, fakeResponse()))).rejects.toBe(boom);
    });
});

describe('McpOauthRateLimitExceptionFilter', () => {
    it('sets Retry-After and sends the 429 body carried by the exception', () => {
        const filter = new McpOauthRateLimitExceptionFilter();
        const res = fakeResponse();
        const exception = new McpOauthRateLimitExceededHttpException(7);

        filter.catch(exception, fakeHost({}, res));

        expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '7');
        expect(res.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
        expect(res.json).toHaveBeenCalledWith({ error: 'rate_limit_exceeded', retryAfterSeconds: 7 });
    });
});
