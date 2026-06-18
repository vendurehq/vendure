import { afterEach, beforeEach, describe, expect, it, SpyInstance, vi } from 'vitest';

import { DefaultLogger } from './default-logger';
import { Logger, LogLevel } from './vendure-logger';

describe('DefaultLogger', () => {
    let stdOutSpy: SpyInstance;
    beforeEach(() => {
        stdOutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        stdOutSpy.mockRestore();
    });

    it('logLevel Debug', () => {
        const logger = new DefaultLogger({ level: LogLevel.Debug });
        Logger.useLogger(logger);

        Logger.debug('AAAA');
        expect(stdOutSpy).toHaveBeenCalledTimes(1);
        expect(stdOutSpy.mock.calls[0][0]).toContain('AAAA');

        Logger.verbose('BBBB');
        expect(stdOutSpy).toHaveBeenCalledTimes(2);
        expect(stdOutSpy.mock.calls[1][0]).toContain('BBBB');

        Logger.info('CCCC');
        expect(stdOutSpy).toHaveBeenCalledTimes(3);
        expect(stdOutSpy.mock.calls[2][0]).toContain('CCCC');

        Logger.warn('DDDD');
        expect(stdOutSpy).toHaveBeenCalledTimes(4);
        expect(stdOutSpy.mock.calls[3][0]).toContain('DDDD');

        Logger.error('EEEE');
        expect(stdOutSpy).toHaveBeenCalledTimes(5);
        expect(stdOutSpy.mock.calls[4][0]).toContain('EEEE');
    });

    it('logLevel Verbose', () => {
        const logger = new DefaultLogger({ level: LogLevel.Verbose });
        Logger.useLogger(logger);

        Logger.debug('AAAA');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.verbose('BBBB');
        expect(stdOutSpy).toHaveBeenCalledTimes(1);
        expect(stdOutSpy.mock.calls[0][0]).toContain('BBBB');

        Logger.info('CCCC');
        expect(stdOutSpy).toHaveBeenCalledTimes(2);
        expect(stdOutSpy.mock.calls[1][0]).toContain('CCCC');

        Logger.warn('DDDD');
        expect(stdOutSpy).toHaveBeenCalledTimes(3);
        expect(stdOutSpy.mock.calls[2][0]).toContain('DDDD');

        Logger.error('EEEE');
        expect(stdOutSpy).toHaveBeenCalledTimes(4);
        expect(stdOutSpy.mock.calls[3][0]).toContain('EEEE');
    });

    it('logLevel Info', () => {
        const logger = new DefaultLogger({ level: LogLevel.Info });
        Logger.useLogger(logger);

        Logger.debug('AAAA');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.verbose('BBBB');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.info('CCCC');
        expect(stdOutSpy).toHaveBeenCalledTimes(1);
        expect(stdOutSpy.mock.calls[0][0]).toContain('CCCC');

        Logger.warn('DDDD');
        expect(stdOutSpy).toHaveBeenCalledTimes(2);
        expect(stdOutSpy.mock.calls[1][0]).toContain('DDDD');

        Logger.error('EEEE');
        expect(stdOutSpy).toHaveBeenCalledTimes(3);
        expect(stdOutSpy.mock.calls[2][0]).toContain('EEEE');
    });

    it('logLevel Warn', () => {
        const logger = new DefaultLogger({ level: LogLevel.Warn });
        Logger.useLogger(logger);

        Logger.debug('AAAA');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.verbose('BBBB');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.info('CCCC');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.warn('DDDD');
        expect(stdOutSpy).toHaveBeenCalledTimes(1);
        expect(stdOutSpy.mock.calls[0][0]).toContain('DDDD');

        Logger.error('EEEE');
        expect(stdOutSpy).toHaveBeenCalledTimes(2);
        expect(stdOutSpy.mock.calls[1][0]).toContain('EEEE');
    });

    it('logLevel Error', () => {
        const logger = new DefaultLogger({ level: LogLevel.Error });
        Logger.useLogger(logger);

        Logger.debug('AAAA');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.verbose('BBBB');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.info('CCCC');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.warn('DDDD');
        expect(stdOutSpy).toHaveBeenCalledTimes(0);

        Logger.error('EEEE');
        expect(stdOutSpy).toHaveBeenCalledTimes(1);
        expect(stdOutSpy.mock.calls[0][0]).toContain('EEEE');
    });
});
