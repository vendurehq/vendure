import { INCLUDE_STACK_IN_ERRORS_ENV_VAR } from '@vendure/common/lib/shared-constants';
import { GraphQLError, GraphQLFormattedError } from 'graphql';

import { trimStack } from '../../common/error/trim-stack';
import { I18nError } from '../../i18n/i18n-error';
import { UNEXPECTED_VENDURE_CODE } from '../../i18n/vendure-code';
import { getRequestId } from '../common/request-id';

/**
 * Whether the APIs add stacks to their errors: `apiOptions.includeStackInErrors` when it is set,
 * and otherwise whether the `VENDURE_INCLUDE_STACK_IN_ERRORS` environment variable is `true`.
 */
export function shouldIncludeStackInErrors(
    includeStackInErrors: boolean | undefined,
    env: Record<string, string | undefined> = process.env,
): boolean {
    return includeStackInErrors ?? env[INCLUDE_STACK_IN_ERRORS_ENV_VAR] === 'true';
}

export interface FormatGraphQLErrorOptions {
    /**
     * Adds `extensions.stack`, the frames of the error's stack under `cwd`. Set by the
     * `apiOptions.includeStackInErrors` option, since the frames name the project's files.
     */
    includeStack: boolean;
    cwd: string;
}

/**
 * Returns the Apollo Server `formatError` function. Each GraphQL error keeps the extensions it was
 * thrown with, so `extensions.code` keeps its existing meaning, and gains:
 *
 * * `vendureCode`: the namespaced code of an {@link I18nError}, or `core.unexpected` for any other error;
 * * `requestId`: the ID of the request, the same as the `x-request-id` response header. It is left out
 *   when the error is formatted outside a request;
 * * `stack`: only when `includeStack` is set, the frames of the stack which point at the project's own files.
 *
 * When the thrown error has no `code`, the code from Apollo Server's formatted error is used, which is
 * `INTERNAL_SERVER_ERROR` unless Apollo or Nest set a more specific one. The internal `http` extension
 * is not sent.
 */
export function createFormatGraphQLError(options: FormatGraphQLErrorOptions) {
    return (formattedError: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
        const originalError = getOriginalError(error);
        const { http, ...thrownExtensions } = error instanceof GraphQLError ? error.extensions : {};
        const extensions: Record<string, unknown> = {
            ...thrownExtensions,
            code: thrownExtensions.code ?? formattedError.extensions?.code,
            vendureCode:
                originalError instanceof I18nError ? originalError.vendureCode : UNEXPECTED_VENDURE_CODE,
        };
        const requestId = getRequestId();
        if (requestId !== undefined) {
            extensions.requestId = requestId;
        }
        if (options.includeStack) {
            extensions.stack = trimStack(
                originalError instanceof Error ? originalError.stack : undefined,
                options.cwd,
            );
        }
        return {
            message: formattedError.message,
            ...(formattedError.locations ? { locations: formattedError.locations } : {}),
            ...(formattedError.path ? { path: formattedError.path } : {}),
            extensions,
        };
    };
}

/**
 * GraphQL wraps an error thrown in a resolver in a GraphQLError, which keeps the thrown error as
 * `originalError`.
 */
function getOriginalError(error: unknown): unknown {
    if (error instanceof GraphQLError && error.originalError) {
        return error.originalError;
    }
    return error;
}
