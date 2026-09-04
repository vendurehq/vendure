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

import { McpRateLimiterService } from './mcp-rate-limiter.service';

export class McpOauthRateLimitExceededHttpException extends HttpException {
    constructor(public readonly retryAfterSeconds: number) {
        super(
            {
                error: 'rate_limit_exceeded',
                error_description: `Too many requests. Retry after ${retryAfterSeconds} seconds.`,
                retry_after_seconds: retryAfterSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}

/**
 * @description
 * Rate-limits OAuth endpoints by client IP, since these endpoints have no authentication of their
 * own. All routes on the OAuth controller share a single quota. Disabled when OAuth IP rate
 * limiting is turned off.
 */
@Injectable()
export class McpOauthRateLimitGuard implements CanActivate {
    constructor(private readonly rateLimiter: McpRateLimiterService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<Request>();
        const exceeded = await this.rateLimiter.checkOauthIpRateLimit(getClientIp(req));
        if (exceeded) {
            throw new McpOauthRateLimitExceededHttpException(exceeded.retryAfterSeconds);
        }
        return true;
    }
}

// Scoped to the controller so it runs before Vendure's app-wide ExceptionLoggerFilter can rewrite the body.
@Catch(McpOauthRateLimitExceededHttpException)
export class McpOauthRateLimitExceptionFilter implements ExceptionFilter {
    catch(exception: McpOauthRateLimitExceededHttpException, host: ArgumentsHost): void {
        const res = host.switchToHttp().getResponse<Response>();
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
        res.status(exception.getStatus()).json(exception.getResponse());
    }
}
