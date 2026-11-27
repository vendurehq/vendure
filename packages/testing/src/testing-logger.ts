import { LogMeta, VendureLogger } from '@vendure/core';

/**
 * @description
 * The TestingLogger can be used in unit tests or e2e tests to make assertions on whether the various
 * Logger methods have been called, and which arguments.
 *
 * Here's some examples of how to use it in e2e tests and unit tests. In both cases we are using
 * the Jest testing framework, but the TestingLogger should work with other similar frameworks
 * (e.g. replacing `jest.fn()` with `jasmine.createSpy()`).
 *
 * @example
 * ```ts
 * // e2e test example
 * import { createTestEnvironment, TestingLogger } from '\@vendure/testing';
 *
 * const testingLogger = new TestingLogger(() => jest.fn());
 *
 * const { server, adminClient, shopClient } = createTestEnvironment({
 *   ...testConfig,
 *   logger: testingLogger,
 * });
 *
 * // e2e testing setup omitted
 *
 * it('should log an error', async () => {
 *   // The `errorSpy` property exposes the Jest mock function
 *   testingLogger.errorSpy.mockClear();
 *
 *   await doSomethingThatErrors();
 *
 *   expect(testingLogger.errorSpy).toHaveBeenCalled();
 * });
 * ```
 *
 * @example
 * ```ts
 * // unit test example
 * import { Test } from '\@nestjs/testing';
 * import { Logger } from '\@vendure/core';
 * import { TestingLogger } from '\@vendure/testing';
 *
 * beforeEach(async () => {
 *   const moduleRef = await Test.createTestingModule({
 *     // Nest testing setup omitted
 *   }).compile();
 *
 *   Logger.useLogger(testingLogger);
 *   moduleRef.useLogger(new Logger());
 * }
 * ```
 *
 * @docsCategory testing
 */
export class TestingLogger<Spy extends (...args: any[]) => any> implements VendureLogger {
    constructor(private createSpyFn: () => Spy) {
        this.debugSpy = createSpyFn();
        this.errorSpy = createSpyFn();
        this.infoSpy = createSpyFn();
        this.verboseSpy = createSpyFn();
        this.warnSpy = createSpyFn();
    }

    debugSpy: Spy;
    errorSpy: Spy;
    infoSpy: Spy;
    verboseSpy: Spy;
    warnSpy: Spy;

    debug(message: string, context?: string, meta?: LogMeta): void {
        this.debugSpy(...withMeta([message, context], meta));
    }

    error(message: string, context?: string, trace?: string, meta?: LogMeta): void {
        this.errorSpy(...withMeta([message, context, trace], meta));
    }

    info(message: string, context?: string, meta?: LogMeta): void {
        this.infoSpy(...withMeta([message, context], meta));
    }

    verbose(message: string, context?: string, meta?: LogMeta): void {
        this.verboseSpy(...withMeta([message, context], meta));
    }

    warn(message: string, context?: string, meta?: LogMeta): void {
        this.warnSpy(...withMeta([message, context], meta));
    }
}

/**
 * Adds `meta` to the spy's arguments only when it is given, so that assertions written before
 * `meta` existed, such as `toHaveBeenCalledWith(message, context)`, still match.
 */
function withMeta(args: unknown[], meta: LogMeta | undefined): unknown[] {
    return meta === undefined ? args : [...args, meta];
}
