import { GraphQLError } from 'graphql';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../../common/error/errors';

import { createFormatGraphQLError } from './format-graphql-error';

describe('createFormatGraphQLError()', () => {
    const cwd = path.resolve('/app');
    const formatted = { message: 'error.forbidden', path: ['me'], extensions: { code: 'FORBIDDEN' } };

    /** GraphQL wraps an error thrown in a resolver like this. */
    function wrap(error: Error) {
        return new GraphQLError(error.message, { path: ['me'], originalError: error });
    }

    it('adds the vendureCode of an I18nError, and keeps its code', () => {
        const format = createFormatGraphQLError({ includeStack: false, cwd });

        expect(format(formatted, wrap(new ForbiddenError()))).toEqual({
            message: 'error.forbidden',
            path: ['me'],
            extensions: { code: 'FORBIDDEN', vendureCode: 'core.forbidden' },
        });
    });

    it('gives any other error the unexpected code, and the code Apollo Server formatted', () => {
        const format = createFormatGraphQLError({ includeStack: false, cwd });
        const result = format(
            { message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
            wrap(new Error('boom')),
        );

        expect(result.extensions).toEqual({ code: 'INTERNAL_SERVER_ERROR', vendureCode: 'core.unexpected' });
    });

    it('keeps the extensions the error was thrown with, except the http field', () => {
        const format = createFormatGraphQLError({ includeStack: false, cwd });
        const error = new GraphQLError('bad', {
            extensions: { code: 'GRAPHQL_VALIDATION_FAILED', http: { status: 400 } },
        });

        expect(format({ message: 'bad', extensions: {} }, error).extensions).toEqual({
            code: 'GRAPHQL_VALIDATION_FAILED',
            vendureCode: 'core.unexpected',
        });
    });

    it('adds the trimmed stack when includeStack is set', () => {
        const format = createFormatGraphQLError({ includeStack: true, cwd });
        const error = new ForbiddenError();
        error.stack = [
            'Error: error.forbidden',
            `    at Guard.canActivate (${path.join(cwd, 'src', 'auth.guard.ts')}:10:3)`,
            `    at run (${path.join(cwd, 'node_modules', 'graphql', 'execute.js')}:1:1)`,
        ].join('\n');

        expect(format(formatted, wrap(error)).extensions?.stack).toEqual([
            `at Guard.canActivate (${path.join('src', 'auth.guard.ts')}:10:3)`,
        ]);
    });

    it('adds no stack when includeStack is not set', () => {
        const format = createFormatGraphQLError({ includeStack: false, cwd });
        expect(format(formatted, wrap(new ForbiddenError())).extensions).not.toHaveProperty('stack');
    });
});
