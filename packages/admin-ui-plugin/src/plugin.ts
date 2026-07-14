import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import {
    DEFAULT_AUTH_TOKEN_HEADER_KEY,
    DEFAULT_CHANNEL_TOKEN_KEY,
} from '@vendure/common/lib/shared-constants';
import {
    AdminUiAppConfig,
    AdminUiAppDevModeConfig,
    AdminUiConfig,
    Type,
} from '@vendure/common/lib/shared-types';
import {
    ConfigService,
    createProxyHandler,
    Logger,
    PluginCommonModule,
    ProcessContext,
    registerPluginStartupMessage,
    VendurePlugin,
} from '@vendure/core';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs-extra';
import path from 'path';

import { getApiExtensions } from './api/api-extensions';
import { MetricsResolver } from './api/metrics.resolver';
import {
    DEFAULT_APP_PATH,
    defaultAvailableLanguages,
    defaultAvailableLocales,
    defaultLanguage,
    defaultLocale,
    loggerCtx,
} from './constants';
import { MetricsService } from './service/metrics.service';

/**
 * @description
 * Configuration options for the {@link AdminUiPlugin}.
 *
 * @docsCategory core plugins/AdminUiPlugin
 */
export interface AdminUiPluginOptions {
    /**
     * @description
     * The route to the Admin UI.
     *
     * Note: If you are using the `compileUiExtensions` function to compile a custom version of the Admin UI, then
     * the route should match the `baseHref` option passed to that function. The default value of `baseHref` is `/admin/`,
     * so it only needs to be changed if you set this `route` option to something other than `"admin"`.
     */
    route: string;
    /**
     * @description
     * The port on which the server will listen. This port will be proxied by the AdminUiPlugin to the same port that
     * the Vendure server is running on.
     */
    port: number;
    /**
     * @description
     * The hostname of the server serving the static admin ui files.
     *
     * @default 'localhost'
     */
    hostname?: string;
    /**
     * @description
     * By default, the AdminUiPlugin comes bundles with a pre-built version of the
     * Admin UI. This option can be used to override this default build with a different
     * version, e.g. one pre-compiled with one or more ui extensions.
     */
    app?: AdminUiAppConfig | AdminUiAppDevModeConfig;
    /**
     * @description
     * Allows the contents of the `vendure-ui-config.json` file to be set, e.g.
     * for specifying the Vendure GraphQL API host, available UI languages, etc.
     */
    adminUiConfig?: Partial<AdminUiConfig>;
    /**
     * @description
     * @deprecated This option no longer has any effect.
     *
     * Previously used when running the AdminUiPlugin at the same time as the new `DashboardPlugin`
     * to avoid conflicts, but this is no longer necessary as the schemas use different type names.
     *
     * @since 3.4.0
     */
    compatibilityMode?: boolean;
}

/**
 * @description
 *
 * :::warning[Deprecated]
 * From Vendure v3.5.0, the Angular-based Admin UI has been replaced by the new [React Admin Dashboard](/extending-the-dashboard/getting-started/).
 * The Angular Admin UI will not be maintained after **July 2026**. Until then, we will continue patching critical bugs and security issues.
 * Community contributions will always be merged and released.
 * :::
 *
 * This plugin starts a static server for the Admin UI app, and proxies it via the `/admin/` path of the main Vendure server.
 *
 * The Admin UI allows you to administer all aspects of your store, from inventory management to order tracking. It is the tool used by
 * store administrators on a day-to-day basis for the management of the store.
 *
 * ## Installation
 *
 * `yarn add \@vendure/admin-ui-plugin`
 *
 * or
 *
 * `npm install \@vendure/admin-ui-plugin`
 *
 * @example
 * ```ts
 * import { AdminUiPlugin } from '\@vendure/admin-ui-plugin';
 *
 * const config: VendureConfig = {
 *   // Add an instance of the plugin to the plugins array
 *   plugins: [
 *     AdminUiPlugin.init({ port: 3002 }),
 *   ],
 * };
 * ```
 *
 * ## Metrics
 *
 * This plugin also defines a `metricSummary` query which is used by the Admin UI to display the order metrics on the dashboard.
 *
 * If you are building a stand-alone version of the Admin UI app, and therefore don't need this plugin to server the Admin UI,
 * you can still use the `metricSummary` query by adding the `AdminUiPlugin` to the `plugins` array, but without calling the `init()` method:
 *
 * @example
 * ```ts
 * import { AdminUiPlugin } from '\@vendure/admin-ui-plugin';
 *
 * const config: VendureConfig = {
 *   plugins: [
 *     AdminUiPlugin, // <-- no call to .init()
 *   ],
 *   // ...
 * };
 * ```
 *
 * @docsCategory core plugins/AdminUiPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: () => getApiExtensions(),
        resolvers: () => [MetricsResolver],
    },
    providers: [MetricsService],
    compatibility: '^3.0.0',
})
export class AdminUiPlugin implements NestModule {
    private static options: AdminUiPluginOptions | undefined;

    constructor(
        private configService: ConfigService,
        private processContext: ProcessContext,
    ) {}

    /**
     * @description
     * Set the plugin options
     */
    static init(options: AdminUiPluginOptions): Type<AdminUiPlugin> {
        this.options = options;
        return AdminUiPlugin;
    }

    async configure(consumer: MiddlewareConsumer) {
        if (this.processContext.isWorker) {
            return;
        }
        if (!AdminUiPlugin.options) {
            Logger.info(
                `AdminUiPlugin's init() method was not called. The Admin UI will not be served.`,
                loggerCtx,
            );
            return;
        }
        const { app, hostname, route, adminUiConfig } = AdminUiPlugin.options;
        const adminUiAppPath = AdminUiPlugin.isDevModeApp(app)
            ? path.join(app.sourcePath, 'src')
            : (app && app.path) || DEFAULT_APP_PATH;
        const adminUiConfigPath = path.join(adminUiAppPath, 'vendure-ui-config.json');
        const indexHtmlPath = path.join(adminUiAppPath, 'index.html');

        const overwriteConfig = async () => {
            const uiConfig = this.getAdminUiConfig(adminUiConfig);
            await this.overwriteAdminUiConfig(adminUiConfigPath, uiConfig);
            await this.overwriteBaseHref(indexHtmlPath, route);
        };

        let port: number;
        if (AdminUiPlugin.isDevModeApp(app)) {
            port = app.port;
        } else {
            port = AdminUiPlugin.options.port;
        }

        if (AdminUiPlugin.isDevModeApp(app)) {
            Logger.info('Creating admin ui middleware (dev mode)', loggerCtx);
            consumer
                .apply(
                    createProxyHandler({
                        hostname,
                        port,
                        route,
                        label: 'Admin UI',
                        basePath: route,
                    }),
                )
                .forRoutes(route);
            consumer
                .apply(
                    createProxyHandler({
                        hostname,
                        port,
                        route: 'sockjs-node',
                        label: 'Admin UI live reload',
                        basePath: 'sockjs-node',
                    }),
                )
                .forRoutes('sockjs-node');

            Logger.info('Compiling Admin UI app in development mode', loggerCtx);
            app.compile().then(
                () => {
                    Logger.info('Admin UI compiling and watching for changes...', loggerCtx);
                },
                (err: any) => {
                    Logger.error(`Failed to compile: ${JSON.stringify(err)}`, loggerCtx, err.stack);
                },
            );
            await overwriteConfig();
        } else {
            Logger.info('Creating admin ui middleware (prod mode)', loggerCtx);
            consumer.apply(this.createStaticServer(app)).forRoutes(route);

            if (app && typeof app.compile === 'function') {
                Logger.info('Compiling Admin UI app in production mode...', loggerCtx);
                app.compile()
                    .then(overwriteConfig)
                    .then(
                        () => {
                            Logger.info('Admin UI successfully compiled', loggerCtx);
                        },
                        (err: any) => {
                            Logger.error(`Failed to compile: ${JSON.stringify(err)}`, loggerCtx, err.stack);
                        },
                    );
            } else {
                await overwriteConfig();
            }
        }
        registerPluginStartupMessage('Admin UI', route);
    }

    private createStaticServer(app?: AdminUiAppConfig) {
        const adminUiAppPath = (app && app.path) || DEFAULT_APP_PATH;

        const limiter = rateLimit({
            windowMs: 60 * 1000,
            limit: process.env.NODE_ENV === 'production' ? 500 : 2000,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const adminUiServer = express.Router();
        // This is a workaround for a type mismatch between express v5 (Vendure core)
        // and express v4 (several transitive dependencies). Can be removed once the
        // ecosystem has more significantly shifted to v5.
        adminUiServer.use(limiter as any);
        adminUiServer.use(express.static(adminUiAppPath));
        adminUiServer.use((req, res) => {
            res.sendFile('index.html', { root: adminUiAppPath });
        });

        return adminUiServer;
    }

    /**
     * Takes an optional AdminUiConfig provided in the plugin options, and returns a complete
     * config object for writing to disk.
     */
    private getAdminUiConfig(partialConfig?: Partial<AdminUiConfig>): AdminUiConfig {
        const { authOptions, apiOptions } = this.configService;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const options = AdminUiPlugin.options!;
        const propOrDefault = <Prop extends keyof AdminUiConfig>(
            prop: Prop,
            defaultVal: AdminUiConfig[Prop],
            isArray: boolean = false,
        ): AdminUiConfig[Prop] => {
            if (isArray) {
                const isValidArray = !!partialConfig
                    ? !!((partialConfig as AdminUiConfig)[prop] as any[])?.length
                    : false;

                return !!partialConfig && isValidArray ? (partialConfig as AdminUiConfig)[prop] : defaultVal;
            } else {
                return partialConfig ? (partialConfig as AdminUiConfig)[prop] || defaultVal : defaultVal;
            }
        };
        const serverTokenMethod = authOptions.tokenMethod;
        const serverUsesBearer =
            serverTokenMethod === 'bearer' ||
            (Array.isArray(serverTokenMethod) && serverTokenMethod.includes('bearer'));
        return {
            adminApiPath: propOrDefault('adminApiPath', apiOptions.adminApiPath),
            apiHost: propOrDefault('apiHost', 'auto'),
            apiPort: propOrDefault('apiPort', 'auto'),
            tokenMethod: propOrDefault('tokenMethod', serverUsesBearer ? 'bearer' : 'cookie'),
            authTokenHeaderKey: propOrDefault(
                'authTokenHeaderKey',
                authOptions.authTokenHeaderKey || DEFAULT_AUTH_TOKEN_HEADER_KEY,
            ),
            channelTokenKey: propOrDefault(
                'channelTokenKey',
                apiOptions.channelTokenKey || DEFAULT_CHANNEL_TOKEN_KEY,
            ),
            defaultLanguage: propOrDefault('defaultLanguage', defaultLanguage),
            defaultLocale: propOrDefault('defaultLocale', defaultLocale),
            availableLanguages: propOrDefault('availableLanguages', defaultAvailableLanguages, true),
            availableLocales: propOrDefault('availableLocales', defaultAvailableLocales, true),
            loginUrl: options.adminUiConfig?.loginUrl,
            brand: options.adminUiConfig?.brand,
            hideVendureBranding: propOrDefault(
                'hideVendureBranding',
                options.adminUiConfig?.hideVendureBranding || false,
            ),
            hideVersion: propOrDefault('hideVersion', options.adminUiConfig?.hideVersion || false),
            loginImageUrl: options.adminUiConfig?.loginImageUrl,
            cancellationReasons: propOrDefault('cancellationReasons', undefined),
        };
    }

    /**
     * Overwrites the parts of the admin-ui app's `vendure-ui-config.json` file relating to connecting to
     * the server admin API.
     */
    private async overwriteAdminUiConfig(adminUiConfigPath: string, config: AdminUiConfig) {
        try {
            const content = await this.pollForFile(adminUiConfigPath);
        } catch (e: any) {
            Logger.error(e.message, loggerCtx);
            throw e;
        }
        try {
            await fs.writeFile(adminUiConfigPath, JSON.stringify(config, null, 2));
        } catch (e: any) {
            throw new Error(
                '[AdminUiPlugin] Could not write vendure-ui-config.json file:\n' + JSON.stringify(e.message),
            );
        }
        Logger.verbose('Applied configuration to vendure-ui-config.json file', loggerCtx);
    }

    /**
     * Overwrites the parts of the admin-ui app's `vendure-ui-config.json` file relating to connecting to
     * the server admin API.
     */
    private async overwriteBaseHref(indexHtmlPath: string, baseHref: string) {
        let indexHtmlContent: string;
        try {
            indexHtmlContent = await this.pollForFile(indexHtmlPath);
        } catch (e: any) {
            Logger.error(e.message, loggerCtx);
            throw e;
        }
        try {
            const withCustomBaseHref = indexHtmlContent.replace(
                /<base href=".+"\s*\/>/,
                `<base href="/${baseHref}/" />`,
            );
            await fs.writeFile(indexHtmlPath, withCustomBaseHref);
        } catch (e: any) {
            throw new Error('[AdminUiPlugin] Could not write index.html file:\n' + JSON.stringify(e.message));
        }
        Logger.verbose(`Applied baseHref "/${baseHref}/" to index.html file`, loggerCtx);
    }

    /**
     * It might be that the ui-devkit compiler has not yet copied the config
     * file to the expected location (particularly when running in watch mode),
     * so polling is used to check multiple times with a delay.
     */
    private async pollForFile(filePath: string) {
        const maxRetries = 10;
        const retryDelay = 200;
        let attempts = 0;

        const pause = () => new Promise(resolve => setTimeout(resolve, retryDelay));

        while (attempts < maxRetries) {
            try {
                Logger.verbose(`Checking for admin ui file: ${filePath}`, loggerCtx);
                const configFileContent = await fs.readFile(filePath, 'utf-8');
                return configFileContent;
            } catch (e: any) {
                attempts++;
                Logger.verbose(
                    `Unable to locate admin ui file: ${filePath} (attempt ${attempts})`,
                    loggerCtx,
                );
            }
            await pause();
        }
        throw new Error(`Unable to locate admin ui file: ${filePath}`);
    }

    private static isDevModeApp(
        app?: AdminUiAppConfig | AdminUiAppDevModeConfig,
    ): app is AdminUiAppDevModeConfig {
        if (!app) {
            return false;
        }
        return !!(app as AdminUiAppDevModeConfig).sourcePath;
    }
}
