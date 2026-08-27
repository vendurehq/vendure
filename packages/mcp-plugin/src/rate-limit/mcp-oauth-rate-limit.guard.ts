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

export class McpOauthRateLimitExceededHttpException extends HttpException {
    constructor(public readonly retryAfterSeconds: number) {
        super({ error: 'rate_limit_exceeded', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
}

/**
 * @description
 * Rate-limits OAuth endpoints by client IP.
 *
 * All routes in the OAuth controller share a single IP-based quota.
 * No authentication is available on these endpoints.
 *
 * Disabled when OAuth IP rate limiting is turned off.
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
