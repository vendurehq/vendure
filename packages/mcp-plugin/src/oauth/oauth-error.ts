import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ZodType } from 'zod';

/**
 * OAuth error codes returned by this server.
 *
 * These mostly follow the OAuth spec. We don’t include `invalid_client`
 * because clients are not authenticated (auth method is "none").
 */
export type McpOauthErrorCode =
    | 'invalid_request'
    | 'invalid_grant'
    | 'unsupported_grant_type'
    | 'invalid_target'
    | 'invalid_client_metadata'
    | 'invalid_redirect_uri'
    | 'server_error';

/**
 * Error thrown by OAuth endpoints (token, client registration).
 *
 * Always returns a 400 response with a standard OAuth error body:
 * { error, error_description }
 */
export class McpOauthError extends BadRequestException {
    readonly code: McpOauthErrorCode;

    constructor(code: McpOauthErrorCode, description: string) {
        super({ error: code, error_description: description });
        this.code = code;
        this.message = description;
    }
}

/**
 * Validates REST payloads against a Zod schema before hitting the service.
 *
 * Prevents unvalidated client input from causing deep 500 errors, converting
 * invalid runtime types into OAuth-compliant 400 responses.
 */
export function parseOAuthInput<T>(schema: ZodType<T>, value: unknown, code: McpOauthErrorCode): T {
    const result = schema.safeParse(value);
    if (result.success) {
        return result.data;
    }
    const issue = result.error.issues[0];
    const fieldPath = issue.path.join('.');
    throw new McpOauthError(code, fieldPath ? `${fieldPath}: ${issue.message}` : issue.message);
}

/**
 * Sends the OAuth error response as-is.
 * Prevents global error handlers from changing the response format.
 */
@Catch(McpOauthError)
export class McpOauthExceptionFilter implements ExceptionFilter {
    catch(exception: McpOauthError, host: ArgumentsHost): void {
        const res = host.switchToHttp().getResponse<Response>();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.status(exception.getStatus()).json(exception.getResponse());
    }
}
