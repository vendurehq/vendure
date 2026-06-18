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
        const distDir = path.join(__dirname, '../dist/graphiql');

        return (req: express.Request, res: express.Response, next: express.NextFunction) => {
            try {
                // Extract asset path from URL
                const assetPath = req.params[0] || req.params.path || '';
                const filePath = path.join(distDir, 'assets', assetPath.toString());

                if (fs.existsSync(filePath)) {
                    return res.sendFile(assetPath.toString(), { root: path.join(distDir, 'assets') });
                } else {
                    return res.status(404).send('Asset not found');
                }
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                Logger.error(`Error serving static asset: ${errorMessage}`, loggerCtx);
                return res.status(500).send('An error occurred while serving static asset');
            }
        };
    }
}
