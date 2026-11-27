import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, InternalServerError, UserInputError } from '../../common/error/errors';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';

import { ExceptionLoggerFilter } from './exception-logger.filter';

vi.mock('../common/parse-context', () => ({
    parseContext: () => ({ req: { path: '/shop-api' }, res: {}, info: {}, isGraphQL: true }),
}));

function createFilter() {
    return new ExceptionLoggerFilter({ systemOptions: { errorHandlers: [] } } as unknown as ConfigService);
}

describe('ExceptionLoggerFilter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs an I18nError with its namespaced code', () => {
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

        createFilter().catch(new ForbiddenError(), {} as ArgumentsHost);

        expect(warn).toHaveBeenCalledWith('FORBIDDEN: error.forbidden', undefined, {
            code: 'core.forbidden',
        });
    });

    it('logs the stack of an I18nError below error level as a debug line with the code', () => {
        vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const debug = vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);
        const exception = new ForbiddenError();

        createFilter().catch(exception, {} as ArgumentsHost);

        expect(debug).toHaveBeenCalledWith(exception.stack, undefined, { code: 'core.forbidden' });
    });

    it('logs an I18nError of a plugin with the code in its namespace', () => {
        class ReviewNotFoundError extends UserInputError {
            static namespace = 'reviews';
        }
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

        createFilter().catch(new ReviewNotFoundError('error.review-not-found'), {} as ArgumentsHost);

        expect(warn).toHaveBeenCalledWith('USER_INPUT_ERROR: error.review-not-found', undefined, {
            code: 'reviews.review-not-found',
        });
    });

    it('logs a 404 HttpException at verbose level without a code', () => {
        const verbose = vi.spyOn(Logger, 'verbose').mockImplementation(() => undefined);

        createFilter().catch(new NotFoundException('Not here'), {} as ArgumentsHost);

        expect(verbose).toHaveBeenCalledWith('Not here');
    });

    it('logs an I18nError at error level with its namespaced code and stack', () => {
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);
        const exception = new InternalServerError('error.entity-with-id-not-found', {
            entityName: 'Product',
            id: '99',
        });

        createFilter().catch(exception, {} as ArgumentsHost);

        expect(error).toHaveBeenCalledWith(
            JSON.stringify(
                {
                    message: 'INTERNAL_SERVER_ERROR: error.entity-with-id-not-found',
                    variables: { entityName: 'Product', id: '99' },
                },
                null,
                2,
            ),
            undefined,
            exception.stack,
            { code: 'core.entity-with-id-not-found' },
        );
    });

    it('logs an I18nError whose message is not a key with the unexpected code', () => {
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

        createFilter().catch(new UserInputError('Something is wrong'), {} as ArgumentsHost);

        expect(warn).toHaveBeenCalledWith('USER_INPUT_ERROR: Something is wrong', undefined, {
            code: 'core.unexpected',
        });
    });

    it('logs any other error with the unexpected code', () => {
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const exception = new TypeError('Cannot read properties of undefined');

        createFilter().catch(exception, {} as ArgumentsHost);

        expect(error).toHaveBeenCalledWith(exception.message, undefined, exception.stack, {
            code: 'core.unexpected',
        });
    });

    it('logs an HttpException other than a 404 with the unexpected code', () => {
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const exception = new BadRequestException('Bad input');

        createFilter().catch(exception, {} as ArgumentsHost);

        expect(error).toHaveBeenCalledWith('Bad input', undefined, exception.stack, {
            code: 'core.unexpected',
        });
    });
});
