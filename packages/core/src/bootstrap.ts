import { DynamicModule, INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestApplicationContextOptions } from '@nestjs/common/interfaces/nest-application-context-options.interface';
import { NestApplicationOptions } from '@nestjs/common/interfaces/nest-application-options.interface';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/typeorm';
import { DEFAULT_COOKIE_NAME } from '@vendure/common/lib/shared-constants';
import { Type } from '@vendure/common/lib/shared-types';
import { satisfies } from 'semver';
import { Connection, DataSourceOptions, EntitySubscriberInterface } from 'typeorm';
import cookieSession = require('cookie-session');

import { InternalServerError } from './common/error/errors';
import { getConfig, setConfig } from './config/config-helpers';
import { DefaultLogger } from './config/logger/default-logger';
import { Logger } from './config/logger/vendure-logger';
import { RuntimeVendureConfig, VendureConfig } from './config/vendure-config';
import { Administrator } from './entity/administrator/administrator.entity';
import { coreEntitiesMap } from './entity/entities';
import { registerCustomEntityFields } from './entity/register-custom-entity-fields';
import { runEntityMetadataModifiers } from './entity/run-entity-metadata-modifiers';
import { setEntityIdStrategy } from './entity/set-entity-id-strategy';
import { setMoneyStrategy } from './entity/set-money-strategy';
import { validateCustomFieldsConfig } from './entity/validate-custom-fields-config';
import { EventBus } from './event-bus';
import { BootstrappedEvent } from './event-bus/events/bootstrapped-event';
import { getCompatibility, getConfigurationFunction, getEntitiesFromPlugins } from './plugin/plugin-metadata';
import { getPluginStartupMessages } from './plugin/plugin-utils';
import { setProcessContext } from './process-context/process-context';
import { isTelemetryDisabled } from './telemetry/helpers/is-telemetry-disabled.helper';
import { VENDURE_VERSION } from './version';
import { VendureWorker } from './worker/vendure-worker';

export type VendureBootstrapFunction = (config: VendureConfig) => Promise<INestApplication>;

/**
 * @description
 * Additional options that can be used to configure the bootstrap process of the
 * Vendure server.
 *
 * @since 2.2.0
 * @docsCategory common
 * @docsPage bootstrap
 */
export interface BootstrapOptions {
    /**
     * @description
     * These options get passed directly to the `NestFactory.create()` method.
     */
    nestApplicationOptions?: NestApplicationOptions;
    /**
     * @description
     * By default, if a plugin specifies a compatibility range which does not include the current
     * Vendure version, the bootstrap process will fail. This option allows you to ignore compatibility
     * errors for specific plugins.
     *
     * This setting should be used with caution, only if you are sure that the plugin will still
     * work as expected with the current version of Vendure.
     *
     * @example
     * ```ts
     * import { bootstrap } from '\@vendure/core';
     * import { config } from './vendure-config';
     * import { MyPlugin } from './plugins/my-plugin';
     *
     * bootstrap(config, {
     *  ignoreCompatibilityErrorsForPlugins: [MyPlugin],
     * });
     * ```
     *
     * @default []
     * @since 3.1.0
     */
    ignoreCompatibilityErrorsForPlugins?: Array<DynamicModule | Type<any>>;

    /**
     * @description
     * A function which is called before the app starts listening. This can be used to perform any final configuration of the Nest application.
     * E.g., to set up OpenAPI specification with Swagger.
     *
     * @example
     * ```ts
     * import { bootstrap } from '\@vendure/core';
     * import { config } from './vendure-config';
     * import { SwaggerModule, DocumentBuilder } from '\@nestjs/swagger';
     *
     * bootstrap(config, {
     *  onBeforeAppListen: async (app) => {
     *    const config = new DocumentBuilder()
     *      .setTitle('Cats example')
     *      .setDescription('The cats API description')
     *      .setVersion('1.0')
     *      .addTag('cats')
     *      .build();
     *    const documentFactory = () => SwaggerModule.createDocument(app, config);
     *    SwaggerModule.setup('api', app, documentFactory);
     *  }
     * });
     * ```
     * @default undefined
     * @since 3.6.0
     */
    onBeforeAppListen?: (app: INestApplication) => void | Promise<void>;
}

/**
 * @description
 * Additional options that can be used to configure the bootstrap process of the
 * Vendure worker.
 *
 * @since 2.2.0
 * @docsCategory worker
 * @docsPage bootstrapWorker
 */
export interface BootstrapWorkerOptions {
    /**
     * @description
     * These options get passed directly to the `NestFactory.createApplicationContext` method.
     */
    nestApplicationContextOptions?: NestApplicationContextOptions;
    /**
     * @description
     * See the `ignoreCompatibilityErrorsForPlugins` option in {@link BootstrapOptions}.
     *
     * @default []
     * @since 3.1.0
     */
    ignoreCompatibilityErrorsForPlugins?: Array<DynamicModule | Type<any>>;
}

/**
 * @description
 * Bootstraps the Vendure server. This is the entry point to the application.
 *
 * @example
 * ```ts
 * import { bootstrap } from '\@vendure/core';
 * import { config } from './vendure-config';
 *
 * bootstrap(config).catch(err => {
 *   console.log(err);
 *   process.exit(1);
 * });
 * ```
 *
 * ### Passing additional options
 *
 * Since v2.2.0, you can pass additional options to the NestJs application via the `options` parameter.
 * For example, to integrate with the [Nest Devtools](https://docs.nestjs.com/devtools/overview), you need to
 * pass the `snapshot` option:
 *
 * ```ts
 * import { bootstrap } from '\@vendure/core';
 * import { config } from './vendure-config';
 *
 * bootstrap(config, {
 *   nestApplicationOptions: { // [!code highlight]
 *     snapshot: true, // [!code highlight]
 *   } // [!code highlight]
 * }).catch(err => {
 *   console.log(err);
 *   process.exit(1);
 * });
 * ```
 *
 * ### Ignoring compatibility errors for plugins
 *
 * Since v3.1.0, you can ignore compatibility errors for specific plugins by passing the `ignoreCompatibilityErrorsForPlugins` option.
 *
 * This should be used with caution, only if you are sure that the plugin will still work as expected with the current version of Vendure.
 *
 * @example
 * ```ts
 * import { bootstrap } from '\@vendure/core';
 * import { config } from './vendure-config';
 * import { MyPlugin } from './plugins/my-plugin';
 *
 * bootstrap(config, {
 *   // Let's say that `MyPlugin` is not yet compatible with the current version of Vendure
 *   // but we know that it will still work as expected, and we are not able to publish
 *   // a new version of the plugin right now.
 *   ignoreCompatibilityErrorsForPlugins: [MyPlugin],
 * });
 * ```
 *
 * @docsCategory common
 * @docsPage bootstrap
 * @docsWeight 0
 * */
export async function bootstrap(
    userConfig: Partial<VendureConfig>,
    options?: BootstrapOptions,
): Promise<INestApplication> {
    const config = await preBootstrapConfig(userConfig);
    Logger.useLogger(config.logger);
    Logger.info(`Bootstrapping Vendure Server (pid: ${process.pid})...`);
    checkPluginCompatibility(config, options?.ignoreCompatibilityErrorsForPlugins);

    // The AppModule *must* be loaded only after the entities have been set in the
    // config, so that they are available when the AppModule decorator is evaluated.
    // eslint-disable-next-line
    const appModule = await import('./app.module.js');
    setProcessContext('server');
    const { hostname, port, cors, middleware, trustProxy } = config.apiOptions;
    DefaultLogger.hideNestBoostrapLogs();
    const app = await NestFactory.create<NestExpressApplication>(appModule.AppModule, {
        cors,
        logger: new Logger(),
        ...options?.nestApplicationOptions,
    });
    DefaultLogger.restoreOriginalLogLevel();
    app.useLogger(new Logger());
    app.set('trust proxy', trustProxy);
    const { tokenMethod } = config.authOptions;
    const usingCookie =
        tokenMethod === 'cookie' || (Array.isArray(tokenMethod) && tokenMethod.includes('cookie'));
    if (usingCookie) {
        configureSessionCookies(app, config);
    }
    const earlyMiddlewares = middleware.filter(mid => mid.beforeListen);
    earlyMiddlewares.forEach(mid => {
        app.use(mid.route, mid.handler);
    });
    await options?.onBeforeAppListen?.(app);
    await app.listen(port, hostname || '');
    app.enableShutdownHooks();
    logWelcomeMessage(config);
    await app.get(EventBus).publish(new BootstrappedEvent());
    return app;
}

/**
 * @description
 * Bootstraps a Vendure worker. Resolves to a {@link VendureWorker} object containing a reference to the underlying
 * NestJs [standalone application](https://docs.nestjs.com/standalone-applications) as well as convenience
 * methods for starting the job queue.
 *
 * Read more about the [Vendure Worker](/developer-guide/worker-job-queue/).
 *
 * @example
 * ```ts
 * import { bootstrapWorker } from '\@vendure/core';
 * import { config } from './vendure-config';
 *
 * bootstrapWorker(config)
 *   .then(worker => worker.startJobQueue())
 *   .catch(err => {
 *     console.log(err);
 *     process.exit(1);
 *   });
 * ```
 * @docsCategory worker
 * @docsPage bootstrapWorker
 * @docsWeight 0
 * */
export async function bootstrapWorker(
    userConfig: Partial<VendureConfig>,
    options?: BootstrapWorkerOptions,
): Promise<VendureWorker> {
    const vendureConfig = await preBootstrapConfig(userConfig);
    const config = disableSynchronize(vendureConfig);
    config.logger.setDefaultContext?.('Vendure Worker');
    Logger.useLogger(config.logger);
    Logger.info(`Bootstrapping Vendure Worker (pid: ${process.pid})...`);
    checkPluginCompatibility(config, options?.ignoreCompatibilityErrorsForPlugins);

    setProcessContext('worker');
    DefaultLogger.hideNestBoostrapLogs();

    const WorkerModule = await import('./worker/worker.module.js').then(m => m.WorkerModule);
    const workerApp = await NestFactory.createApplicationContext(WorkerModule, {
        logger: new Logger(),
        ...options?.nestApplicationContextOptions,
    });
    DefaultLogger.restoreOriginalLogLevel();
    workerApp.useLogger(new Logger());
    workerApp.enableShutdownHooks();
    await validateDbTablesForWorker(workerApp);
    Logger.info('Vendure Worker is ready');
    await workerApp.get(EventBus).publish(new BootstrappedEvent());
    return new VendureWorker(workerApp);
}

/**
 * Setting the global config must be done prior to loading the AppModule.
 */
export async function preBootstrapConfig(
    userConfig: Partial<VendureConfig>,
): Promise<Readonly<RuntimeVendureConfig>> {
    if (userConfig) {
        await setConfig(userConfig);
    }

    const entities = getAllEntities(userConfig);
    const { coreSubscribersMap } = await import('./entity/subscribers.js');
    await setConfig({
        dbConnectionOptions: {
            entities,
            subscribers: [
                ...((userConfig.dbConnectionOptions?.subscribers ?? []) as Array<
                    Type<EntitySubscriberInterface>
                >),
                ...(Object.values(coreSubscribersMap) as Array<Type<EntitySubscriberInterface>>),
            ],
        },
    });

    let config = getConfig();
    // The logger is set here so that we are able to log any messages prior to the final
    // logger (which may depend on config coming from a plugin) being set.
    Logger.useLogger(config.logger);
    config = await runPluginConfigurations(config);
    const entityIdStrategy = config.entityOptions.entityIdStrategy ?? config.entityIdStrategy;
    setEntityIdStrategy(entityIdStrategy, entities);
    const moneyStrategy = config.entityOptions.moneyStrategy;
    setMoneyStrategy(moneyStrategy, entities);
    const customFieldValidationResult = validateCustomFieldsConfig(config.customFields, entities);
    if (!customFieldValidationResult.valid) {
        process.exitCode = 1;
        throw new Error('CustomFields config error:\n- ' + customFieldValidationResult.errors.join('\n- '));
    }
    registerCustomEntityFields(config);
    await runEntityMetadataModifiers(config);
    setExposedHeaders(config);
    return config;
}

function checkPluginCompatibility(
    config: RuntimeVendureConfig,
    ignoredPlugins: Array<DynamicModule | Type<any>> = [],
): void {
    for (const plugin of config.plugins) {
        const compatibility = getCompatibility(plugin);
        const pluginName = (plugin as any).name as string;
        if (!compatibility) {
            Logger.info(
                `The plugin "${pluginName}" does not specify a compatibility range, so it is not guaranteed to be compatible with this version of Vendure.`,
            );
        } else {
            if (!satisfies(VENDURE_VERSION, compatibility, { loose: true, includePrerelease: true })) {
                const compatibilityErrorMessage =
                    `Plugin "${pluginName}" is not compatible with this version of Vendure. ` +
                    `It specifies a semver range of "${compatibility}" but the current version is "${VENDURE_VERSION}".`;
                if (ignoredPlugins.includes(plugin)) {
                    Logger.warn(
                        compatibilityErrorMessage +
                            `However, this plugin has been explicitly marked as ignored using the 'ignoreCompatibilityErrorsForPlugins' bootstrap option,` +
                            ` so it will be loaded anyway.`,
                    );
                    continue;
                } else {
                    Logger.error(compatibilityErrorMessage);
                    throw new InternalServerError(
                        `Plugin "${pluginName}" is not compatible with this version of Vendure.`,
                    );
                }
            }
        }
    }
}

/**
 * Run the configuration functions of all plugins and return the final config object.
 */
export async function runPluginConfigurations(config: RuntimeVendureConfig): Promise<RuntimeVendureConfig> {
    for (const plugin of config.plugins) {
        const configFn = getConfigurationFunction(plugin);
        if (typeof configFn === 'function') {
            const result = await configFn(config);
            Object.assign(config, result);
        }
    }
    return config;
}

/**
 * Returns an array of core entities and any additional entities defined in plugins.
 */
export function getAllEntities(userConfig: Partial<VendureConfig>): Array<Type<any>> {
    const coreEntities = Object.values(coreEntitiesMap) as Array<Type<any>>;
    const pluginEntities = getEntitiesFromPlugins(userConfig.plugins);

    const allEntities: Array<Type<any>> = coreEntities;

    // Check to ensure that no plugins are defining entities with names
    // which conflict with existing entities.
    for (const pluginEntity of pluginEntities) {
        if (allEntities.find(e => e.name === pluginEntity.name)) {
            throw new InternalServerError('error.entity-name-conflict', { entityName: pluginEntity.name });
        } else {
            allEntities.push(pluginEntity);
        }
    }
    return allEntities;
}

/**
 * If the 'bearer' tokenMethod is being used, then we automatically expose the authTokenHeaderKey header
 * in the CORS options, making sure to preserve any user-configured exposedHeaders.
 */
function setExposedHeaders(config: Readonly<RuntimeVendureConfig>) {
    const { tokenMethod } = config.authOptions;
    const isUsingBearerToken =
        tokenMethod === 'bearer' || (Array.isArray(tokenMethod) && tokenMethod.includes('bearer'));
    if (isUsingBearerToken) {
        const authTokenHeaderKey = config.authOptions.authTokenHeaderKey;
        const corsOptions = config.apiOptions.cors;
        if (typeof corsOptions !== 'boolean') {
            const { exposedHeaders } = corsOptions;
            let exposedHeadersWithAuthKey: string[];
            if (!exposedHeaders) {
                exposedHeadersWithAuthKey = [authTokenHeaderKey];
            } else if (typeof exposedHeaders === 'string') {
                exposedHeadersWithAuthKey = exposedHeaders
                    .split(',')
                    .map(x => x.trim())
                    .concat(authTokenHeaderKey);
            } else {
                exposedHeadersWithAuthKey = exposedHeaders.concat(authTokenHeaderKey);
            }
            corsOptions.exposedHeaders = exposedHeadersWithAuthKey;
        }
    }
}

function logWelcomeMessage(config: RuntimeVendureConfig) {
    const { port, shopApiPath, adminApiPath, hostname } = config.apiOptions;
    const apiCliGreetings: Array<readonly [string, string]> = [];
    const pathToUrl = (path: string) => `http://${hostname || 'localhost'}:${port}/${path}`;
    apiCliGreetings.push(['Shop API', pathToUrl(shopApiPath)]);
    apiCliGreetings.push(['Admin API', pathToUrl(adminApiPath)]);
    apiCliGreetings.push(
        ...getPluginStartupMessages().map(({ label, path }) => [label, pathToUrl(path)] as const),
    );
    const columnarGreetings = arrangeCliGreetingsInColumns(apiCliGreetings);
    const title = `Vendure server (v${VENDURE_VERSION}) now running on port ${port}`;
    const maxLineLength = Math.max(title.length, ...columnarGreetings.map(l => l.length));
    const titlePadLength = title.length < maxLineLength ? Math.floor((maxLineLength - title.length) / 2) : 0;
    Logger.info('='.repeat(maxLineLength));
    Logger.info(title.padStart(title.length + titlePadLength));
    Logger.info('-'.repeat(maxLineLength).padStart(titlePadLength));
    columnarGreetings.forEach(line => Logger.info(line));
    Logger.info('='.repeat(maxLineLength));
    if (isTelemetryDisabled()) {
        Logger.info('Anonymous telemetry is disabled.');
    } else {
        Logger.info('Anonymous telemetry is enabled to help us improve Vendure.');
        Logger.info('To disable, set VENDURE_DISABLE_TELEMETRY=true.');
    }
}

function arrangeCliGreetingsInColumns(lines: Array<readonly [string, string]>): string[] {
    const columnWidth = Math.max(...lines.map(l => l[0].length)) + 2;
    return lines.map(l => `${(l[0] + ':').padEnd(columnWidth)}${l[1]}`);
}

/**
 * Fix race condition when modifying DB
 * See: https://github.com/vendurehq/vendure/issues/152
 */
function disableSynchronize(userConfig: Readonly<RuntimeVendureConfig>): Readonly<RuntimeVendureConfig> {
    const config = {
        ...userConfig,
        dbConnectionOptions: {
            ...userConfig.dbConnectionOptions,
            synchronize: false,
        } as DataSourceOptions,
    };
    return config;
}

/**
 * Check that the Database tables exist. When running Vendure server & worker
 * concurrently for the first time, the worker will attempt to access the
 * DB tables before the server has populated them (assuming synchronize = true
 * in config). This method will use polling to check the existence of a known table
 * before allowing the rest of the worker bootstrap to continue.
 * @param worker
 */
async function validateDbTablesForWorker(worker: INestApplicationContext) {
    const connection: Connection = worker.get(getConnectionToken());
    await new Promise<void>(async (resolve, reject) => {
        const checkForTables = async (): Promise<boolean> => {
            try {
                const adminCount = await connection.getRepository(Administrator).count();
                return 0 < adminCount;
            } catch (e: any) {
                return false;
            }
        };

        const pollIntervalMs = 5000;
        let attempts = 0;
        const maxAttempts = 10;
        let validTableStructure = false;
        Logger.verbose('Checking for expected DB table structure...');
        while (!validTableStructure && attempts < maxAttempts) {
            attempts++;
            validTableStructure = await checkForTables();
            if (validTableStructure) {
                Logger.verbose('Table structure verified');
                resolve();
                return;
            }
            Logger.verbose(
                `Table structure could not be verified, trying again after ${pollIntervalMs}ms (attempt ${attempts} of ${maxAttempts})`,
            );
            await new Promise(resolve1 => setTimeout(resolve1, pollIntervalMs));
        }
        reject('Could not validate DB table structure. Aborting bootstrap.');
    });
}

export function configureSessionCookies(
    app: INestApplication,
    userConfig: Readonly<RuntimeVendureConfig>,
): void {
    const { cookieOptions } = userConfig.authOptions;

    // Globally set the cookie session middleware
    const cookieName =
        typeof cookieOptions?.name !== 'string' ? cookieOptions.name?.shop : cookieOptions.name;
    app.use(
        cookieSession({
            ...cookieOptions,
            name: cookieName ?? DEFAULT_COOKIE_NAME,
        }),
    );
}
