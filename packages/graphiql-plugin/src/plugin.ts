import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Type } from '@vendure/common/lib/shared-types';
import {
    ConfigService,
    Logger,
    PluginCommonModule,
    ProcessContext,
    registerPluginStartupMessage,
    VendurePlugin,
} from '@vendure/core';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { loggerCtx, PLUGIN_INIT_OPTIONS } from './constants';
import { GraphiQLService } from './graphiql.service';
import { GraphiqlPluginOptions } from './types';

/**
 * @description
 * This plugin provides a GraphiQL UI for exploring and testing the Vendure GraphQL APIs.
 *
 * It adds routes `/graphiql/admin` and `/graphiql/shop` which serve the GraphiQL interface
 * for the respective APIs.
 *
 * ## Installation
 *
 * ```ts
 * import { GraphiqlPlugin } from '\@vendure/graphiql-plugin';
 *
 * const config: VendureConfig = {
 *   // Add an instance of the plugin to the plugins array
 *   plugins: [
 *     GraphiqlPlugin.init({
 *       route: 'graphiql', // Optional, defaults to 'graphiql'
 *     }),
 *   ],
 * };
 * ```
 *
 * ## Custom API paths
 *
 * By default, the plugin automatically reads the Admin API and Shop API paths from your Vendure configuration.
 *
 * If you need to override these paths, you can specify them explicitly:
 *
 * ```typescript
 * GraphiQLPlugin.init({
 *     route: 'my-custom-route', // defaults to `graphiql`
 * });
 * ```
 *
 * ## Query parameters
 *
 * You can add the following query parameters to the GraphiQL URL:
 *
 * - `?query=...` - Pre-populate the query editor with a GraphQL query.
 * - `?embeddedMode=true` - This renders the editor in embedded mode, which hides the header and
 *    the API switcher. This is useful for embedding GraphiQL in other applications such as documentation.
 *    In this mode, the editor also does not persist changes across reloads.
 *
 * @docsCategory core plugins/GraphiqlPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        GraphiQLService,
        {
            provide: PLUGIN_INIT_OPTIONS,
            useFactory: () => GraphiqlPlugin.options,
        },
    ],
    configuration: config => {
        // disable GraphQL playground in config
        config.apiOptions.adminApiPlayground = false;
        config.apiOptions.shopApiPlayground = false;
        return config;
    },
    exports: [GraphiQLService],
    compatibility: '^3.0.0',
})
export class GraphiqlPlugin implements NestModule {
    static options: Required<GraphiqlPluginOptions>;

    constructor(
        private readonly processContext: ProcessContext,
        private readonly configService: ConfigService,
        private readonly graphiQLService: GraphiQLService,
    ) {}

    /**
     * Initialize the plugin with the given options.
     */
    static init(options: GraphiqlPluginOptions = {}): Type<GraphiqlPlugin> {
        this.options = {
            ...options,
            route: options.route || 'graphiql',
        };
        return GraphiqlPlugin;
    }

    configure(consumer: MiddlewareConsumer) {
        if (!this.processContext.isServer) {
            return;
        }

        const adminRoute = GraphiqlPlugin.options.route + '/admin';
        const shopRoute = GraphiqlPlugin.options.route + '/shop';

        consumer.apply(this.createStaticServer()).forRoutes(adminRoute);
        consumer.apply(this.createStaticServer()).forRoutes(shopRoute);

        // Add middleware for serving assets
        consumer.apply(this.createAssetsServer()).forRoutes('/graphiql/assets/*path');

        registerPluginStartupMessage('GraphiQL Admin', adminRoute);
        registerPluginStartupMessage('GraphiQL Shop', shopRoute);
    }

    private createStaticServer() {
        const distDir = path.join(__dirname, '../dist/graphiql');

        const adminApiUrl = this.graphiQLService.getAdminApiUrl();
        const shopApiUrl = this.graphiQLService.getShopApiUrl();

        return (req: express.Request, res: express.Response) => {
            try {
                const indexHtmlPath = path.join(distDir, 'index.html');

                if (fs.existsSync(indexHtmlPath)) {
                    // Read the HTML file
                    let html = fs.readFileSync(indexHtmlPath, 'utf-8');

                    // Inject API URLs
                    html = html.replace(
                        '</head>',
                        `<script>
                                window.GRAPHIQL_SETTINGS = {
                                    adminApiUrl: "${adminApiUrl}",
                                    shopApiUrl: "${shopApiUrl}"
                                };
                            </script>
                            </head>`,
                    );

                    return res.send(html);
                }

                throw new Error(`GraphiQL UI not found: ${indexHtmlPath}`);
            } catch (e) {
                const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                Logger.error(`Error serving GraphiQL: ${errorMessage}`, 'GraphiQLPlugin');
                return res.status(500).send('An error occurred while rendering GraphiQL');
            }
        };
    }

    private createAssetsServer() {
        const assetsDir = path.join(__dirname, '../dist/graphiql/assets');

        return (req: express.Request, res: express.Response, next: express.NextFunction) => {
            const notFound = () => res.status(404).send('Asset not found');
            try {
                // Express 5 provides the `*path` wildcard as an array of decoded segments.
                // A segment may itself contain a decoded "/" (from "%2F"), so the resolved
                // path must be checked against the assets dir before touching the filesystem.
                const rawPath: string | string[] = req.params.path ?? '';
                const assetPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;
                const filePath = path.resolve(assetsDir, assetPath);
                if (!filePath.startsWith(assetsDir + path.sep)) {
                    return notFound();
                }
                if (!isFile(filePath)) {
                    return notFound();
                }
                return res.sendFile(path.relative(assetsDir, filePath), { root: assetsDir }, err => {
                    if (err && !res.headersSent) {
                        notFound();
                    }
                });
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                Logger.error(`Error serving static asset: ${errorMessage}`, loggerCtx);
                return res.status(500).send('An error occurred while serving static asset');
            }
        };
    }
}

/**
 * Any stat failure (missing entry, over-long name, null byte) is treated as "not a file", so the
 * caller can respond the same way for all of them.
 */
function isFile(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}
