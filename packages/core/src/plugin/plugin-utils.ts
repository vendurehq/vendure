import { RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { Logger } from '../config';

/**
 * @description
 * Creates a proxy middleware which proxies the given route to the given port.
 * Useful for plugins which start their own servers but should be accessible
 * via the main Vendure url.
 *
 * @example
 * ```ts
 * // Example usage in the `configuration` method of a VendurePlugin.
 * // Imagine that we have started a Node server on port 5678
 * // running some service which we want to access via the `/my-plugin/`
 * // route of the main Vendure server.
 * \@VendurePlugin({
 *   configuration: (config: Required<VendureConfig>) => {
 *       config.apiOptions.middleware.push({
 *           handler: createProxyHandler({
 *               label: 'Admin UI',
 *               route: 'my-plugin',
 *               port: 5678,
 *           }),
 *           route: 'my-plugin',
 *       });
 *       return config;
 *   }
 * })
 * export class MyPlugin {}
 * ```
 *
 * @docsCategory Plugin
 * @docsPage Plugin Utilities
 */
export function createProxyHandler(options: ProxyOptions): RequestHandler {
    const route = options.route.charAt(0) === '/' ? options.route : '/' + options.route;
    const proxyHostname = options.hostname || 'localhost';
    const middleware = createProxyMiddleware({
        // TODO: how do we detect https?
        target: `http://${proxyHostname}:${options.port}/${options.basePath ?? ''}`,
        pathRewrite: {
            [`^${route}`]: '/' + (options.basePath || ''),
        },
        logger: {
            log(message: string) {
                Logger.debug(message, options.label);
            },
            debug(message: string) {
                Logger.debug(message, options.label);
            },
            info(message: string) {
                Logger.debug(message, options.label);
            },
            warn(message: string) {
                Logger.warn(message, options.label);
            },
            error(message: string) {
                Logger.error(message, options.label);
            },
        },
    });
    return middleware;
}

/**
 * @description
 * Options to configure proxy middleware via {@link createProxyHandler}.
 *
 * @docsCategory Plugin
 * @docsPage Plugin Utilities
 */
export interface ProxyOptions {
    /**
     * @description
     * A human-readable label for the service which is being proxied. Used to
     * generate more informative logs.
     */
    label: string;
    /**
     * @description
     * The route of the Vendure server which will act as the proxy url.
     */
    route: string;
    /**
     * @description
     * The port on which the service being proxied is running.
     */
    port: number;
    /**
     * @description
     * The hostname of the server on which the service being proxied is running.
     *
     * @default 'localhost'
     */
    hostname?: string;
    /**
     * @description
     * An optional base path on the proxied server.
     */
    basePath?: string;
}

const pluginStartupMessages: Array<{ label: string; path: string }> = [];

/**
 * Use this function to add a line to the bootstrap log output listing a service added
 * by this plugin.
 */
export function registerPluginStartupMessage(serviceName: string, path: string) {
    pluginStartupMessages.push({ label: serviceName, path });
}

export function getPluginStartupMessages(): ReadonlyArray<{ label: string; path: string }> {
    return pluginStartupMessages;
}
