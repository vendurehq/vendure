import {
    ArgumentsHost,
    CanActivate,
    Catch,
    ExceptionFilter,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { getClientIp } from '../get-client-ip';

import { McpRateLimiterService, McpRateLimitExceededError } from './mcp-rate-limiter.service';

/**
 * Thrown by the guard when an IP is over budget. It needs its own class because Vendure's
 * app-wide ExceptionLoggerFilter replaces the body of every plain HttpException — the
 * controller-scoped filter below catches this class first and keeps the intended 429 body.
 */
export class McpOauthRateLimitExceededHttpException extends HttpException {
    constructor(public readonly retryAfterSeconds: number) {
        super({ error: 'rate_limit_exceeded', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
}

/**
 * @description
 * Rate-limits the whole OAuth HTTP surface by client IP. Attached at class level on
 * `McpOauthController`, so every route on it — including ones added later — shares one
 * bucket per IP. These routes take no credentials, so the IP is the only thing to meter by.
 *
 * A no-op when `rateLimits.oauthIp` is disabled (`false` or `rpm <= 0`).
 */
@Injectable()
export class McpOauthRateLimitGuard implements CanActivate {
    constructor(private rateLimiter: McpRateLimiterService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<Request>();
        try {
            await this.rateLimiter.enforceOauthIpRateLimit(getClientIp(req));
        } catch (e) {
            if (!(e instanceof McpRateLimitExceededError)) {
                throw e;
            }
            throw new McpOauthRateLimitExceededHttpException(e.details.retryAfterSeconds);
        }
        return true;
    }
}

/**
 * Answers an over-budget request: sets `Retry-After` and sends the exception's own 429 body.
 * Controller-scoped filters run before app-wide ones, which is what keeps Vendure's
 * ExceptionLoggerFilter from rewriting the body.
 */
@Catch(McpOauthRateLimitExceededHttpException)
export class McpOauthRateLimitExceptionFilter implements ExceptionFilter {
    catch(exception: McpOauthRateLimitExceededHttpException, host: ArgumentsHost): void {
        const res = host.switchToHttp().getResponse<Response>();
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
        res.status(exception.getStatus()).json(exception.getResponse());
    }
}
