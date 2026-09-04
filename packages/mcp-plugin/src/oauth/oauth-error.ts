import {
    ArgumentsHost,
    BadRequestException,
    Catch,
    ExceptionFilter,
    UnauthorizedException,
} from '@nestjs/common';
import { Logger } from '@vendure/core';
import type { Response } from 'express';
import type { ZodType } from 'zod';

import { loggerCtx } from '../constants';

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
 * A bearer token whose own lifetime has run out, while the grant behind it is otherwise fine.
 * Kept apart from the other 401s so the transport can answer it as a routine refresh rather
 * than as a failed authentication attempt.
 */
export class McpAccessTokenExpiredError extends UnauthorizedException {
    constructor() {
        super('Access token expired');
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
 * Answers every bad request from the OAuth endpoints with the OAuth error body, so a client has
 * one shape to parse: an {@link McpOauthError} is sent as-is, and any other 400 raised on the way
 * (an unknown client, a rejected client metadata document) becomes an `invalid_request` carrying
 * its message. Also prevents global error handlers from changing the response format.
 */
@Catch(BadRequestException)
export class McpOauthExceptionFilter implements ExceptionFilter {
    catch(exception: BadRequestException, host: ArgumentsHost): void {
        const res = host.switchToHttp().getResponse<Response>();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        let body: unknown;
        if (exception instanceof McpOauthError) {
            body = exception.getResponse();
        } else {
            Logger.warn(`OAuth request rejected: ${exception.message}`, loggerCtx);
            body = { error: 'invalid_request', error_description: exception.message };
        }
        res.status(exception.getStatus()).json(body);
    }
}
