import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DefaultLogger, JobQueueService, Logger, VendureConfig } from '@vendure/core';
import { preBootstrapConfig, configureSessionCookies } from '@vendure/core/dist/bootstrap';

import { populateForTesting } from './data-population/populate-for-testing';
import { getInitializerFor } from './initializers/initializers';
import { TestServerOptions } from './types';

/* eslint-disable no-console */
/**
 * @description
 * A real Vendure server against which the e2e tests should be run.
 *
 * @docsCategory testing
 */
export class TestServer {
    public app: INestApplication;

    constructor(private vendureConfig: Required<VendureConfig>) {}

    /**
     * @description
     * Bootstraps an instance of Vendure server and populates the database according to the options
     * passed in. Should be called in the `beforeAll` function.
     *
     * The populated data is saved into an .sqlite file for each test file. On subsequent runs, this file
     * is loaded so that the populate step can be skipped, which speeds up the tests significantly.
     */
    async init(options: TestServerOptions): Promise<void> {
        const { type } = this.vendureConfig.dbConnectionOptions;
        const { dbConnectionOptions } = this.vendureConfig;
        const testFilename = this.getCallerFilename(1);
        const initializer = getInitializerFor(type);
        try {
            await initializer.init(testFilename, dbConnectionOptions);
            const populateFn = () => this.populateInitialData(this.vendureConfig, options);
            await initializer.populate(populateFn);
            await initializer.destroy();
        } catch (e: any) {
            throw e;
        }
        await this.bootstrap();
    }

    /**
     * @description
     * Bootstraps a Vendure server instance. Generally the `.init()` method should be used, as that will also
     * populate the test data. However, the `bootstrap()` method is sometimes useful in tests which need to
     * start and stop a Vendure instance multiple times without re-populating data.
     */
    async bootstrap() {
        this.app = await this.bootstrapForTesting(this.vendureConfig);
    }

    /**
     * @description
     * Destroy the Vendure server instance and clean up all resources.
     * Should be called after all tests have run, e.g. in an `afterAll` function.
     */
    async destroy() {
        // allow a grace period of any outstanding async tasks to complete
        await new Promise(resolve => global.setTimeout(resolve, 500));
        await this.app?.close();
    }

    private getCallerFilename(depth: number): string {
        let stack: any;
        let file: any;
        let frame: any;

        const pst = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, _stack) => {
            Error.prepareStackTrace = pst;
            return _stack;
        };

        stack = new Error().stack;
        stack = stack.slice(depth + 1);

        do {
            frame = stack.shift();
            file = frame && frame.getFileName();
        } while (stack.length && file === 'module.js');

        return file;
    }

    /**
     * Populates an .sqlite database file based on the PopulateOptions.
     */
    private async populateInitialData(
        testingConfig: Required<VendureConfig>,
        options: TestServerOptions,
    ): Promise<void> {
        const app = await populateForTesting(testingConfig, this.bootstrapForTesting, {
            logging: false,
            ...options,
        });
        await app.close();
    }

    /**
     * Bootstraps an instance of the Vendure server for testing against.
     */
    private async bootstrapForTesting(
        this: void,
        userConfig: Partial<VendureConfig>,
    ): Promise<INestApplication> {
        const config = await preBootstrapConfig(userConfig);
        Logger.useLogger(config.logger);
        const appModule = await import('@vendure/core/dist/app.module.js');
        try {
            DefaultLogger.hideNestBoostrapLogs();
            const app = await NestFactory.create(appModule.AppModule, {
                cors: config.apiOptions.cors,
                logger: new Logger(),
                abortOnError: false,
            });
            const { tokenMethod } = config.authOptions;
            const usingCookie =
                tokenMethod === 'cookie' || (Array.isArray(tokenMethod) && tokenMethod.includes('cookie'));
            if (usingCookie) {
                configureSessionCookies(app, config);
            }
            const earlyMiddlewares = config.apiOptions.middleware.filter(mid => mid.beforeListen);
            earlyMiddlewares.forEach(mid => {
                app.use(mid.route, mid.handler);
            });
            await app.listen(config.apiOptions.port);
            await app.get(JobQueueService).start();
            DefaultLogger.restoreOriginalLogLevel();
            return app;
        } catch (e: any) {
            console.log(e);
            throw e;
        }
    }
}
