import { preloadSchemas } from '@modelcontextprotocol/server';
import { MiddlewareConsumer, NestModule, OnApplicationBootstrap, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import {
    I18nService,
    Logger,
    PluginCommonModule,
    ProcessContext,
    SettingsStoreScopes,
    VendurePlugin,
} from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { McpAdminResolver, McpToolCallLogEntityResolver } from './api/mcp-admin.resolver';
import { McpShopResolver } from './api/mcp-shop.resolver';
import {
    MCP_PLUGIN_OPTIONS,
    MCP_SETTINGS_NAMESPACE,
    MCP_TOOL_TOGGLES_FIELD_NAME,
    loggerCtx,
    mcpServerPermission,
} from './constants';
import {
    McpAuthorizationCode,
    McpAuthorizationRequest,
    McpOauthClient,
    McpOauthGrant,
    McpToolCallLog,
} from './entities';
import { ResolvedMcpPluginOptions } from './internal-types';
import { McpToolCallLogService } from './logging/mcp-tool-call-log.service';
import { McpCimdClientResolverService } from './oauth/cimd/cimd-client-resolver.service';
import { isLoopbackHostname } from './oauth/loopback';
import { McpOauthRetentionService } from './oauth/oauth-retention.service';
import { McpOauthController } from './oauth/oauth.controller';
import { McpOauthService } from './oauth/oauth.service';
import { McpOauthRateLimitGuard } from './rate-limit/mcp-oauth-rate-limit.guard';
import { McpRateLimiterService } from './rate-limit/mcp-rate-limiter.service';
import { McpToolExecutionService } from './registry/mcp-tool-execution.service';
import { McpToolRegistryService } from './registry/mcp-tool-registry.service';
import { McpToolSchemaService } from './registry/mcp-tool-schema.service';
import { resolveMcpPluginOptions } from './resolve-options';
import { McpShopSessionService } from './shop-session/mcp-shop-session.service';
import { mcpOauthRetentionTask } from './tasks/mcp-oauth-retention.task';
import { mcpToolCallLogRetentionTask } from './tasks/mcp-tool-call-log-retention.task';
import { McpActiveOrderService } from './tools/built-in/active-order.service';
import { McpCatalogQueryService } from './tools/built-in/catalog-query.service';
import { mcpBuiltInToolProviders } from './tools/built-in/providers';
import { McpToolSerializerService } from './tools/built-in/serializer.service';
import { McpTransportController } from './transport/mcp-transport.controller';
import { McpPluginOptions } from './types';

/**
 * @description
 * Exposes Vendure's data and operations to AI agents via the [Model Context Protocol](https://modelcontextprotocol.io/).
 * Tools decorated with `@McpTool` are automatically discovered and registered at bootstrap.
 *
 * @example
 * ```ts
 * import { McpPlugin } from '\@vendure/mcp-plugin';
 *
 * const config: VendureConfig = {
 *     plugins: [
 *         // Tools are exposed directly by default. Pass `toolExposure: 'discovery'`
 *         // to expose a small set of search/execute meta-tools instead.
 *         McpPlugin.init({}),
 *     ],
 * };
 * ```
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@VendurePlugin({
    imports: [PluginCommonModule, DiscoveryModule],
    controllers: [McpOauthController, McpTransportController],
    providers: [
        { provide: MCP_PLUGIN_OPTIONS, useFactory: () => McpPlugin.options },
        McpOauthService,
        McpOauthRetentionService,
        McpCimdClientResolverService,
        McpToolRegistryService,
        McpToolSchemaService,
        McpToolExecutionService,
        McpShopSessionService,
        McpRateLimiterService,
        McpOauthRateLimitGuard,
        McpToolCallLogService,
        McpActiveOrderService,
        McpToolSerializerService,
        McpCatalogQueryService,
        ...mcpBuiltInToolProviders,
    ],
    entities: [McpOauthClient, McpAuthorizationCode, McpAuthorizationRequest, McpOauthGrant, McpToolCallLog],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [McpAdminResolver, McpToolCallLogEntityResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [McpShopResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    configuration: config => {
        // No issuer configured: default to the address the API server actually listens on.
        // Correct for local development only. In production the loopback check below
        // refuses it, so a public issuer must always be set explicitly there.
        if (McpPlugin.options.oauth && !McpPlugin.options.oauth.issuer) {
            McpPlugin.options.oauth.issuer = `http://localhost:${config.apiOptions.port}`;
        }
        config.authOptions.customPermissions.push(mcpServerPermission);
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            [MCP_SETTINGS_NAMESPACE]: [
                {
                    name: MCP_TOOL_TOGGLES_FIELD_NAME,
                    scope: SettingsStoreScopes.global,
                    requiresPermission: { read: mcpServerPermission.Read, write: mcpServerPermission.Update },
                    validate: value =>
                        value == null || typeof value === 'object'
                            ? undefined
                            : 'MCP tool toggles must be an object',
                },
            ],
        };
        config.schedulerOptions.tasks.push(
            mcpToolCallLogRetentionTask.configure({
                schedule: McpPlugin.options.logging?.retentionSchedule,
            }),
            mcpOauthRetentionTask.configure({
                schedule: McpPlugin.options.oauth?.retentionSchedule,
            }),
        );
        return config;
    },
    compatibility: '^3.8.0',
})
export class McpPlugin implements NestModule, OnApplicationBootstrap {
    /**
     * @description
     * The plugin options with every default applied. `init()` sets this, so it holds no value
     * until the plugin is added to your Vendure config.
     */
    static options: ResolvedMcpPluginOptions;

    constructor(
        private processContext: ProcessContext,
        private i18nService: I18nService,
    ) {}

    /**
     * Adds Vendure's error translation middleware to MCP routes, so callers receive translated
     * error messages instead of i18n keys.
     */
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(this.i18nService.handle()).forRoutes('mcp/shop', 'mcp/admin');
    }

    /**
     * @description
     * Sets the plugin options and returns the plugin class to add to your `plugins` array.
     * Any option you leave out falls back to its default.
     */
    static init(options: McpPluginOptions = {}): Type<McpPlugin> {
        this.options = resolveMcpPluginOptions(options);
        return McpPlugin;
    }

    /**
     * @description
     * Runs at startup, and only does work on the main server process. Builds the MCP message
     * schemas up front so the first request does not pay for it. Also checks the configured
     * OAuth options, and throws when one is invalid or unsafe for a production server.
     */
    onApplicationBootstrap(): void {
        // Only the main server serves the OAuth routes, so only it needs this check.
        if (!this.processContext.isServer) {
            return;
        }
        // The SDK builds the schemas it validates MCP messages against on first use. Build them
        // now so that cost lands on startup rather than on whichever request arrives first.
        preloadSchemas();

        const logging = McpPlugin.options.logging;
        if (logging?.capture === 'full' && !logging.redact) {
            Logger.warn(
                'Full MCP logging is enabled without redaction. ' +
                    'This may store sensitive data. Add logging.redact to sanitize logs, ' +
                    'or switch to metadata-only logging.',
                loggerCtx,
            );
        }
        const oauth = McpPlugin.options.oauth;
        if (!oauth) {
            return;
        }

        this.assertIssuerIsOrigin(oauth.issuer);
        this.assertAdminConsentPathIsRelative(oauth.adminConsentPath);
        this.assertTokenSecretIsSet(oauth.tokenSecret);

        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction) {
            if (oauth.allowLoopbackCimdDocuments) {
                throw new Error(
                    `McpPlugin: oauth.allowLoopbackCimdDocuments cannot be enabled in production. ` +
                        `It lets any caller of the authorize endpoint make this server open a ` +
                        `connection to any port on the machine it runs on, and is only meant for ` +
                        `fetching a client metadata document from your own development setup.`,
                );
            }
            if (this.isLoopbackUrl(oauth.issuer)) {
                throw new Error(
                    `McpPlugin: oauth.issuer cannot be a loopback URL ("${oauth.issuer ?? ''}") in production. ` +
                        `Set it to your public Vendure server URL so clients can reach it.`,
                );
            }
            if (new URL(oauth.issuer ?? '').protocol !== 'https:') {
                throw new Error(
                    `McpPlugin: oauth.issuer must use https in production ("${oauth.issuer ?? ''}").`,
                );
            }
            if (oauth.storefrontConsentUrl != null) {
                if (this.isLoopbackUrl(oauth.storefrontConsentUrl)) {
                    throw new Error(
                        `McpPlugin: oauth.storefrontConsentUrl cannot be a loopback URL ` +
                            `("${oauth.storefrontConsentUrl}") in production. Set it to your public ` +
                            `storefront consent page URL.`,
                    );
                }
                if (new URL(oauth.storefrontConsentUrl).protocol !== 'https:') {
                    throw new Error(
                        `McpPlugin: oauth.storefrontConsentUrl must use https in production ` +
                            `("${oauth.storefrontConsentUrl}"). A consent page carries a customer's ` +
                            `session, so it cannot be served over plain HTTP.`,
                    );
                }
            }
        }
    }

    private assertAdminConsentPathIsRelative(path?: string): void {
        if (path != null && (!path.startsWith('/') || path.startsWith('//'))) {
            throw new Error(
                `McpPlugin: oauth.adminConsentPath must be a path starting with "/" (for example ` +
                    `"/dashboard/mcp/authorize") — got "${path}". It is resolved against oauth.issuer, ` +
                    `because the admin consent page must be served by the Vendure server itself.`,
            );
        }
    }

    private assertTokenSecretIsSet(tokenSecret: string): void {
        if (!tokenSecret) {
            throw new Error(
                'McpPlugin: oauth.tokenSecret is required and cannot be empty. It is used to securely hash and verify issued OAuth tokens.',
            );
        }
    }

    private assertIssuerIsOrigin(issuer?: string): void {
        let url: URL;
        try {
            url = new URL(issuer ?? '');
        } catch {
            throw new Error(
                `McpPlugin: oauth.issuer must be a valid URL such as "https://example.com" — ` +
                    `received "${issuer ?? ''}". Include the scheme; a host on its own is not a URL.`,
            );
        }
        if (url.pathname !== '/' || url.search || url.hash) {
            throw new Error(
                `McpPlugin: oauth.issuer must be the scheme, host and port of your Vendure server ` +
                    `(for example "https://example.com") with no path, query or fragment — got ` +
                    `"${issuer ?? ''}". If Vendure is served under a path, either give it its own ` +
                    `subdomain or have the proxy forward /.well-known/* to it as well.`,
            );
        }
    }

    private isLoopbackUrl(url?: string): boolean {
        if (!url) return true;

        try {
            return isLoopbackHostname(new URL(url).hostname);
        } catch {
            // Not a valid URL, so not a real public address either — treat as unsafe.
            return true;
        }
    }
}
