import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

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
    constructor(code: McpOauthErrorCode, description: string) {
        super({ error: code, error_description: description });
        this.message = description;
    }
}

/**
 * Sends the OAuth error response as-is.
 * Prevents global error handlers from changing the response format.
 */
@Catch(McpOauthError)
export class McpOauthExceptionFilter implements ExceptionFilter {
    catch(exception: McpOauthError, host: ArgumentsHost): void {
        const res = host.switchToHttp().getResponse<Response>();
        res.status(exception.getStatus()).json(exception.getResponse());
    }
}
