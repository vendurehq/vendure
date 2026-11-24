import { ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, InternalServerError } from '../../common/error/errors';
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

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('FORBIDDEN'), undefined, {
            code: 'core.forbidden',
        });
    });

    it('logs an I18nError at error level with its namespaced code and stack', () => {
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);
        const exception = new InternalServerError('error.entity-with-id-not-found');

        createFilter().catch(exception, {} as ArgumentsHost);

        expect(error).toHaveBeenCalledWith(expect.any(String), undefined, exception.stack, {
            code: 'core.entity-with-id-not-found',
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
});
