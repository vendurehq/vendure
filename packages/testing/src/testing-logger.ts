import { VendureLogger } from '@vendure/core';

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

    debug(message: string, context?: string): void {
        this.debugSpy(message, context);
    }

    error(message: string, context?: string, trace?: string): void {
        this.errorSpy(message, context, trace);
    }

    info(message: string, context?: string): void {
        this.infoSpy(message, context);
    }

    verbose(message: string, context?: string): void {
        this.verboseSpy(message, context);
    }

    warn(message: string, context?: string): void {
        this.warnSpy(message, context);
    }
}
