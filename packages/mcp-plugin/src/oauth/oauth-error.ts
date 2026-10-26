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

/** Follows the OAuth spec's error codes, minus `invalid_client` since clients here are never authenticated. */
export type McpOauthErrorCode =
    | 'invalid_request'
    | 'invalid_grant'
    | 'unsupported_grant_type'
    | 'invalid_target'
    | 'invalid_client_metadata'
    | 'invalid_redirect_uri'
    | 'server_error';

export class McpOauthError extends BadRequestException {
    readonly code: McpOauthErrorCode;

    constructor(code: McpOauthErrorCode, description: string) {
        super({ error: code, error_description: description });
        this.code = code;
        this.message = description;
    }
}

/** Kept apart from other 401s so the transport can treat it as a routine token refresh rather than a failed authentication attempt. */
export class McpAccessTokenExpiredError extends UnauthorizedException {
    constructor() {
        super('Access token expired');
    }
}

/** Converts a schema failure into an OAuth-compliant 400, so bad client input never reaches the service as a 500. */
export function parseOAuthInput<T>(schema: ZodType<T>, value: unknown, code: McpOauthErrorCode): T {
    const result = schema.safeParse(value);
    if (result.success) {
        return result.data;
    }
    const issue = result.error.issues[0];
    const fieldPath = issue.path.join('.');
    throw new McpOauthError(code, fieldPath ? `${fieldPath}: ${issue.message}` : issue.message);
}

/** Ensures every 400 from the OAuth endpoints comes back in the OAuth error shape, so clients only ever parse one format. */
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
