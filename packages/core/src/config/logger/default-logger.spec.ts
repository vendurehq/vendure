import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { runWithRequestId } from '../../api/common/request-id';

import { DefaultLogger, formatTextLine } from './default-logger';
import { Logger, LogLevel } from './vendure-logger';

describe('DefaultLogger', () => {
    let stdOutSpy: MockInstance<typeof process.stdout.write>;
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

    describe('json format', () => {
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        function writtenLines() {
            return stdOutSpy.mock.calls.map(call => {
                const output = String(call[0]);
                expect(output.endsWith('\n')).toBe(true);
                expect(output.slice(0, -1)).not.toContain('\n');
                return JSON.parse(output);
            });
        }

        it('writes one LogLine object per line', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json', level: LogLevel.Debug }));

            Logger.info('Hello', 'MyPlugin');

            const [line] = writtenLines();
            expect(Object.keys(line).sort()).toEqual(['ctx', 'level', 'msg', 'ts']);
            expect(line).toMatchObject({ level: 'info', ctx: 'MyPlugin', msg: 'Hello' });
            expect(new Date(line.ts).toISOString()).toBe(line.ts);
        });

        it('writes the level names', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json', level: LogLevel.Debug }));

            Logger.error('a');
            Logger.warn('b');
            Logger.info('c');
            Logger.verbose('d');
            Logger.debug('e');

            expect(writtenLines().map(line => line.level)).toEqual([
                'error',
                'warn',
                'info',
                'verbose',
                'debug',
            ]);
        });

        it('uses the default context when there is none', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            Logger.info('Hello');

            expect(writtenLines()[0].ctx).toBe('Vendure Server');
        });

        it('writes the trace of an error as the stack, and the code from the meta', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            Logger.error('Failed', 'MyPlugin', 'Error: Failed\n    at foo.ts:1:1', { code: 'FORBIDDEN' });

            expect(writtenLines()[0]).toMatchObject({
                level: 'error',
                msg: 'Failed',
                stack: 'Error: Failed\n    at foo.ts:1:1',
                code: 'FORBIDDEN',
            });
        });

        it('writes the current request ID', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            runWithRequestId('req-1', () => Logger.info('In a request'));
            Logger.info('Outside a request');

            const [inRequest, outside] = writtenLines();
            expect(inRequest.requestId).toBe('req-1');
            expect(outside).not.toHaveProperty('requestId');
        });

        it('writes the process name from VENDURE_PROCESS', () => {
            vi.stubEnv('VENDURE_PROCESS', 'worker');
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            Logger.info('Hello');

            expect(writtenLines()[0].process).toBe('worker');
        });

        it('writes a message object as a string', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            Logger.info({ a: 1 } as any);

            expect(JSON.parse(writtenLines()[0].msg)).toEqual({ a: 1 });
        });

        it('never writes colours', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            Logger.error('Failed', 'MyPlugin', 'trace');
            Logger.warn('Careful');

            for (const call of stdOutSpy.mock.calls) {
                expect(String(call[0])).not.toContain('\u001b[');
            }
        });

        it('is selected by VENDURE_LOG_FORMAT when the option is not set', () => {
            vi.stubEnv('VENDURE_LOG_FORMAT', 'json');
            Logger.useLogger(new DefaultLogger());

            Logger.info('Hello');

            expect(writtenLines()[0].msg).toBe('Hello');
        });

        describe('process context', () => {
            // The process context cannot be unset, so these tests set it on fresh copies of the
            // modules, and the other tests keep an unset one.
            async function loadFreshModules() {
                vi.resetModules();
                const processContext = await import('../../process-context/process-context');
                const defaultLogger = await import('./default-logger');
                const vendureLogger = await import('./vendure-logger');
                return {
                    setProcessContext: processContext.setProcessContext,
                    FreshDefaultLogger: defaultLogger.DefaultLogger,
                    FreshLogger: vendureLogger.Logger,
                };
            }

            it('writes the process context set by bootstrap, read when the line is written', async () => {
                const { setProcessContext, FreshDefaultLogger, FreshLogger } = await loadFreshModules();
                FreshLogger.useLogger(new FreshDefaultLogger({ format: 'json' }));
                setProcessContext('worker');

                FreshLogger.info('Hello');

                expect(writtenLines()[0].process).toBe('worker');
            });

            it('the process name from VENDURE_PROCESS wins over the process context', async () => {
                const { setProcessContext, FreshDefaultLogger, FreshLogger } = await loadFreshModules();
                setProcessContext('server');
                vi.stubEnv('VENDURE_PROCESS', 'custom');
                FreshLogger.useLogger(new FreshDefaultLogger({ format: 'json' }));

                FreshLogger.info('Hello');

                expect(writtenLines()[0].process).toBe('custom');
            });
        });

        it('writes no process before bootstrap sets the context', () => {
            Logger.useLogger(new DefaultLogger({ format: 'json' }));

            Logger.info('Hello');

            expect(writtenLines()[0]).not.toHaveProperty('process');
        });

        it('reads VENDURE_LOG_FORMAT when each line is written', () => {
            const logger = new DefaultLogger();
            Logger.useLogger(logger);
            vi.stubEnv('VENDURE_LOG_FORMAT', 'json');

            Logger.info('Hello');

            expect(writtenLines()[0].msg).toBe('Hello');
        });

        it('the option wins over VENDURE_LOG_FORMAT', () => {
            vi.stubEnv('VENDURE_LOG_FORMAT', 'json');
            Logger.useLogger(new DefaultLogger({ format: 'text' }));

            Logger.info('Hello');

            expect(() => JSON.parse(String(stdOutSpy.mock.calls[0][0]))).toThrow();
        });
    });

    describe('text format', () => {
        const withoutColours = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

        it('writes the level, the context and the message on one line', () => {
            Logger.useLogger(new DefaultLogger({ timestamp: false }));

            runWithRequestId('req-1', () => Logger.info('Hello', 'MyPlugin'));

            expect(withoutColours(String(stdOutSpy.mock.calls[0][0]))).toBe('info [MyPlugin] Hello\n');
        });

        it('writes the timestamp after the level', () => {
            Logger.useLogger(new DefaultLogger());

            Logger.warn('Careful', 'MyPlugin');

            expect(withoutColours(String(stdOutSpy.mock.calls[0][0]))).toMatch(
                /^warn \S.* - \[MyPlugin\] Careful\n$/,
            );
        });

        it('formatTextLine() appends the stack to the message', () => {
            const text = formatTextLine(
                {
                    ts: new Date().toISOString(),
                    level: 'error',
                    ctx: 'MyPlugin',
                    msg: 'Failed',
                    stack: 'at x',
                },
                { timestamp: false },
            );
            expect(withoutColours(text)).toBe('error [MyPlugin] Failed\nat x');
        });
    });

    describe('Logger', () => {
        it('calls the logger with exactly the arguments it was given when there is no meta', () => {
            const custom = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), verbose: vi.fn(), debug: vi.fn() };
            Logger.useLogger(custom);

            Logger.info('Hello', 'MyPlugin');
            Logger.error('Failed', 'MyPlugin', 'trace');
            Logger.warn('Careful', 'MyPlugin', { code: 'FORBIDDEN' });

            expect(custom.info.mock.calls[0]).toEqual(['Hello', 'MyPlugin']);
            expect(custom.error.mock.calls[0]).toEqual(['Failed', 'MyPlugin', 'trace']);
            expect(custom.warn.mock.calls[0]).toEqual(['Careful', 'MyPlugin', { code: 'FORBIDDEN' }]);
        });
    });
});
