import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Type } from '@vendure/common/lib/shared-types';
import {
    createProxyHandler,
    Logger,
    PluginCommonModule,
    ProcessContext,
    registerPluginStartupMessage,
    SettingsStoreScopes,
    VendurePlugin,
} from '@vendure/core';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { adminApiExtensions } from './api/api-extensions.js';
import { MetricsResolver } from './api/metrics.resolver.js';
import { loggerCtx, manageDashboardGlobalViews } from './constants.js';
import { MetricsService } from './service/metrics.service.js';

/**
 * @description
 * Configuration options for the {@link DashboardPlugin}.
 *
 * @docsCategory core plugins/DashboardPlugin
 */
export interface DashboardPluginOptions {
    /**
     * @description
     * The route to the Dashboard UI.
     *
     * @default 'dashboard'
     */
    route: string;
    /**
     * @description
     * The path to the dashboard UI app dist directory.
     */
    appDir: string;
    /**
     * @description
     * The port on which to check for a running Vite dev server.
     * If a Vite dev server is detected on this port, requests will be proxied to it
     * instead of serving static files from appDir.
     *
     * @default 5173
     */
    viteDevServerPort?: number;
}

/**
 * @description
 * This plugin serves the static files of the Vendure Dashboard and provides the
 * GraphQL extensions needed for the order metrics on the dashboard index page.
 *
 * ## Installation
 *
 * `npm install \@vendure/dashboard`
 *
 * ## Usage
 *
 * First you need to set up compilation of the Dashboard, using the Vite configuration
 * described in the [Dashboard Getting Started Guide](/extending-the-dashboard/getting-started/)
 *
 * ## Development vs Production
 *
 * When developing, you can run `npx vite` (or `npm run dev`) to start the Vite development server.
 * The plugin will automatically detect if Vite is running on the default port (5173) and proxy
 * requests to it instead of serving static files. This enables hot module replacement and faster
 * development iterations.
 *
 * For production, run `npx vite build` to build the dashboard app. The built app files will be
 * output to the location specified by `build.outDir` in your Vite config file. This should then
 * be passed to the `appDir` init option, as in the example below:
 *
 * @example
 * ```ts
 * import { DashboardPlugin } from '\@vendure/dashboard/plugin';
 *
 * const config: VendureConfig = {
 *   // Add an instance of the plugin to the plugins array
 *   plugins: [
 *     DashboardPlugin.init({
 *       route: 'dashboard',
 *       appDir: './dist/dashboard',
 *       // Optional: customize Vite dev server port (defaults to 5173)
 *       viteDevServerPort: 3000,
 *     }),
 *   ],
 * };
 * ```
 *
 * ## Metrics
 *
 * This plugin defines a `metricSummary` query which is used by the Dashboard UI to
 * display the order metrics on the dashboard.
 *
 * If you are building a stand-alone version of the Dashboard UI app, and therefore
 * don't need this plugin to serve the Dashboard UI, you can still use the
 * `metricSummary` query by adding the `DashboardPlugin` to the `plugins` array,
 * but without calling the `init()` method:
 *
 * @example
 * ```ts
 * import { DashboardPlugin } from '\@vendure/dashboard-plugin';
 *
 * const config: VendureConfig = {
 *   plugins: [
 *     DashboardPlugin, // <-- no call to .init()
 *   ],
 *   // ...
 * };
 * ```
 *
 * @docsCategory core plugins/DashboardPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [MetricsResolver],
    },
    providers: [MetricsService],
    configuration: config => {
        config.authOptions.customPermissions.push(manageDashboardGlobalViews);

        config.settingsStoreFields['vendure.dashboard'] = [
            {
                name: 'userSettings',
                scope: SettingsStoreScopes.user,
            },
            {
                name: 'globalSavedViews',
                scope: SettingsStoreScopes.global,
                requiresPermission: {
                    read: manageDashboardGlobalViews.Read,
                    write: manageDashboardGlobalViews.Write,
                },
            },
            {
                name: 'userSavedViews',
                scope: SettingsStoreScopes.user,
            },
        ];
        return config;
    },
    compatibility: '^3.0.0',
})
export class DashboardPlugin implements NestModule {
    private static options: DashboardPluginOptions | undefined;
    private readonly rateLimitRequests = process.env.NODE_ENV === 'production' ? 500 : 100_000;

    constructor(private readonly processContext: ProcessContext) {}

    /**
     * @description
     * Set the plugin options
     */
    static init(options: DashboardPluginOptions): Type<DashboardPlugin> {
        this.options = options;
        return DashboardPlugin;
    }

    configure(consumer: MiddlewareConsumer) {
        if (this.processContext.isWorker) {
            return;
        }
        if (!DashboardPlugin.options) {
            Logger.warn(
                `DashboardPlugin's init() method was not called. The Dashboard UI will not be served.`,
                loggerCtx,
            );
            return;
        }
        const { route, appDir, viteDevServerPort = 5173 } = DashboardPlugin.options;

        Logger.verbose('Creating dashboard middleware', loggerCtx);

        consumer.apply(this.createDynamicHandler(route, appDir, viteDevServerPort)).forRoutes(route);

        registerPluginStartupMessage('Dashboard UI', route);
    }

    private createStaticServer(dashboardPath: string) {
        const limiter = rateLimit({
            windowMs: 60 * 1000,
            limit: this.rateLimitRequests,
            standardHeaders: true,
            legacyHeaders: false,
            // Content-hashed bundles under /assets/ are immutable and a single
            // page load fires ~190 chunk requests; counting them against the
            // bucket exhausts it within a few tabs (see #4665).
            skip: req => req.path.startsWith('/assets/'),
        });

        const dashboardServer = express.Router();
        dashboardServer.use(limiter);
        // Serve hashed assets with a long-lived immutable Cache-Control header
        // so CDNs and browsers can cache them indefinitely. This is safe because
        // Vite emits content-hashed filenames into /assets — a missing chunk
        // means a stale reference, so the explicit 404 handler below stops the
        // request from falling through to the SPA index.html shell, which would
        // otherwise be served with the asset's expected MIME and crash the app
        // on "Unexpected token '<'".
        dashboardServer.use(
            '/assets',
            express.static(path.join(dashboardPath, 'assets'), {
                maxAge: '1y',
                immutable: true,
            }),
        );
        dashboardServer.use('/assets', (_req, res) => res.status(404).end());
        dashboardServer.use(express.static(dashboardPath));
        dashboardServer.use((req, res) => {
            res.sendFile('index.html', { root: dashboardPath });
        });

        return dashboardServer;
    }

    private async checkViteDevServer(port: number): Promise<boolean> {
        return new Promise(resolve => {
            const req = http.request(
                {
                    hostname: 'localhost',
                    port,
                    path: '/',
                    method: 'HEAD',
                    timeout: 1000,
                },
                (res: http.IncomingMessage) => {
                    resolve(res.statusCode !== undefined && res.statusCode < 400);
                },
            );

            req.on('error', () => {
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });

            req.end();
        });
    }

    private checkBuiltFiles(appDir: string): boolean {
        try {
            const indexPath = path.join(appDir, 'index.html');
            return fs.existsSync(indexPath);
        } catch {
            return false;
        }
    }

    private createDefaultPage() {
        const limiter = rateLimit({
            windowMs: 60 * 1000,
            limit: this.rateLimitRequests,
            standardHeaders: true,
            legacyHeaders: false,
        });

        const defaultPageServer = express.Router();
        defaultPageServer.use(limiter);

        defaultPageServer.use((req, res) => {
            try {
                const htmlPath = path.join(__dirname, 'default-page.html');
                const defaultHtml = fs.readFileSync(htmlPath, 'utf8');
                res.setHeader('Content-Type', 'text/html');
                res.send(defaultHtml);
            } catch (error) {
                res.status(500).send(
                    `Unable to load default page: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        });

        return defaultPageServer;
    }

    private createDynamicHandler(route: string, appDir: string, viteDevServerPort: number) {
        const limiter = rateLimit({
            windowMs: 60 * 1000,
            limit: this.rateLimitRequests,
            standardHeaders: true,
            legacyHeaders: false,
            // See note in createStaticServer — /assets/* is immutable and a
            // single page load fires ~190 chunk requests.
            skip: req => req.path.startsWith('/assets/'),
        });

        // Pre-create handlers to avoid recreating them on each request
        const proxyHandler = createProxyHandler({
            label: 'Dashboard Vite Dev Server',
            route,
            port: viteDevServerPort,
            basePath: route,
        });

        const staticServer = this.createStaticServer(appDir);
        const defaultPage = this.createDefaultPage();

        // Track current mode to log changes
        let currentMode: 'vite' | 'built' | 'default' | null = null;

        const dynamicRouter = express.Router();
        dynamicRouter.use(limiter);

        // Add status endpoint for polling (localhost only for security)
        dynamicRouter.get(
            '/__status',
            (req, res, next) => {
                const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
                const isLocalhost =
                    clientIp === '127.0.0.1' ||
                    clientIp === '::1' ||
                    clientIp === '::ffff:127.0.0.1' ||
                    clientIp === 'localhost';

                if (!isLocalhost) {
                    return res.status(403).json({ error: 'Access denied' });
                }

                next();
            },
            async (req, res) => {
                try {
                    const isViteRunning = await this.checkViteDevServer(viteDevServerPort);
                    const hasBuiltFiles = this.checkBuiltFiles(appDir);
                    const mode = isViteRunning ? 'vite' : hasBuiltFiles ? 'built' : 'default';
                    res.json({
                        viteRunning: isViteRunning,
                        hasBuiltFiles,
                        mode,
                    });
                } catch (error) {
                    res.status(500).json({
                        error: `Status check failed: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            },
        );

        dynamicRouter.use(async (req, res, next) => {
            try {
                // Check for Vite dev server first (highest priority)
                const isViteRunning = await this.checkViteDevServer(viteDevServerPort);
                const hasBuiltFiles = this.checkBuiltFiles(appDir);

                // Determine new mode
                const staticMode = hasBuiltFiles ? 'built' : 'default';
                const newMode: 'vite' | 'built' | 'default' = isViteRunning ? 'vite' : staticMode;

                // Log mode change
                if (currentMode !== newMode) {
                    const modeDescriptions = {
                        vite: 'Vite dev server (with HMR)',
                        built: 'built static files',
                        default: 'default getting-started page',
                    };

                    if (currentMode !== null) {
                        Logger.info(
                            `Dashboard mode changed: ${currentMode} → ${newMode} (serving ${modeDescriptions[newMode]})`,
                            loggerCtx,
                        );
                    }
                    currentMode = newMode;
                }

                // Route to appropriate handler
                if (isViteRunning) {
                    return proxyHandler(req, res, next);
                }

                if (hasBuiltFiles) {
                    return staticServer(req, res, next);
                }

                // Fall back to default page
                return defaultPage(req, res, next);
            } catch (error) {
                Logger.error(`Dashboard dynamic handler error: ${String(error)}`, loggerCtx);
                res.status(500).send('Dashboard unavailable');
            }
        });

        return dynamicRouter;
    }
}
