import { preloadSchemas } from '@modelcontextprotocol/server';
import { MiddlewareConsumer, NestModule, OnApplicationBootstrap, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import {
    ConfigService,
    I18nService,
    Logger,
    PluginCommonModule,
    ProcessContext,
    RuntimeVendureConfig,
    SettingsStoreScopes,
    VendurePlugin,
} from '@vendure/core';

import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { McpActorService } from './api/mcp-actor.service';
import {
    McpAdminResolver,
    McpOauthGrantEntityResolver,
    McpToolCallLogEntityResolver,
} from './api/mcp-admin.resolver';
import { McpShopResolver } from './api/mcp-shop.resolver';
import { checkMcpPluginOptions } from './check-options';
import {
    loggerCtx,
    MCP_LOCAL_TRUST_ACTIVATION,
    MCP_PLUGIN_OPTIONS,
    MCP_SETTINGS_NAMESPACE,
    MCP_TOOL_TOGGLES_FIELD_NAME,
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
import {
    LOCAL_TRUST_OFF,
    LocalTrustActivation,
    readLocalTrustActivation,
} from './local-trust/local-trust-activation';
import { LocalTrustService } from './local-trust/local-trust.service';
import { McpToolCallLogRetentionService } from './logging/mcp-tool-call-log-retention.service';
import { McpToolCallLogService } from './logging/mcp-tool-call-log.service';
import { McpCimdClientResolverService } from './oauth/cimd/cimd-client-resolver.service';
import { McpGrantSessionService } from './oauth/grant-session.service';
import { McpOauthMetadataService } from './oauth/oauth-metadata.service';
import { McpOauthRetentionService } from './oauth/oauth-retention.service';
import { McpOauthController } from './oauth/oauth.controller';
import { McpOauthService } from './oauth/oauth.service';
import { McpOauthRateLimitGuard } from './rate-limit/mcp-oauth-rate-limit.guard';
import { McpRateLimiterService } from './rate-limit/mcp-rate-limiter.service';
import { McpConsentService } from './registry/mcp-consent.service';
import { McpToolExecutionService } from './registry/mcp-tool-execution.service';
import { McpToolRegistryService } from './registry/mcp-tool-registry.service';
import { McpToolSchemaService } from './registry/mcp-tool-schema.service';
import { resolveMcpPluginOptions } from './resolve-options';
import { McpShopSessionService } from './shop-session/mcp-shop-session.service';
import { mcpOauthRetentionTask } from './tasks/mcp-oauth-retention.task';
import { mcpToolCallLogRetentionTask } from './tasks/mcp-tool-call-log-retention.task';
import { McpActiveOrderService } from './tools/built-in/active-order.service';
import { McpCatalogQueryService } from './tools/built-in/catalog-query.service';
import { McpCustomFieldInputService } from './tools/built-in/custom-field-input.service';
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
        { provide: MCP_LOCAL_TRUST_ACTIVATION, useFactory: () => McpPlugin.localTrustState.activation },
        LocalTrustService,
        McpOauthService,
        McpGrantSessionService,
        McpOauthMetadataService,
        McpOauthRetentionService,
        McpCimdClientResolverService,
        McpToolRegistryService,
        McpToolSchemaService,
        McpConsentService,
        McpToolExecutionService,
        McpShopSessionService,
        McpRateLimiterService,
        McpOauthRateLimitGuard,
        McpToolCallLogService,
        McpToolCallLogRetentionService,
        McpActiveOrderService,
        McpToolSerializerService,
        McpCatalogQueryService,
        McpCustomFieldInputService,
        McpActorService,
        ...mcpBuiltInToolProviders,
    ],
    entities: [McpOauthClient, McpAuthorizationCode, McpAuthorizationRequest, McpOauthGrant, McpToolCallLog],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [McpAdminResolver, McpToolCallLogEntityResolver, McpOauthGrantEntityResolver],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [McpShopResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    configuration: config => {
        // Defaults to the API server's own address; correct for local development only, since
        // a production server is required to set an explicit public issuer.
        if (McpPlugin.options.oauth && !McpPlugin.options.oauth.issuer) {
            McpPlugin.options.oauth.issuer = `http://localhost:${config.apiOptions.port}`;
        }
        McpPlugin.activateLocalTrust(config);
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
    compatibility: '^4.0.0',
})
export class McpPlugin implements NestModule, OnApplicationBootstrap {
    /**
     * @description
     * The plugin options with every default applied. `init()` sets this, so it holds no value
     * until the plugin is added to your Vendure config.
     */
    static options: ResolvedMcpPluginOptions;

    /**
     * Local trust as the `configuration` hook decided it. The hook updates the fields in place.
     *
     * - `activation`: whether local trust is on for the app being bootstrapped.
     * - `processRead`: what this process read from the CLI's secret. The secret is deleted from
     *   the environment on the first read, and one process often runs the configuration hooks
     *   more than once, for example `runMigrations()` and then `bootstrap()`, so later runs
     *   reuse this.
     *
     * @internal
     */
    static readonly localTrustState: { activation: LocalTrustActivation; processRead: LocalTrustActivation } =
        {
            activation: LOCAL_TRUST_OFF,
            processRead: LOCAL_TRUST_OFF,
        };

    /** Set when the `configuration` hook added `'bearer'` to the token method, so bootstrap can log it. */
    private static addedBearerTokenMethod = false;

    constructor(
        private readonly processContext: ProcessContext,
        private readonly i18nService: I18nService,
        private readonly configService: ConfigService,
        private readonly localTrust: LocalTrustService,
    ) {}

    /**
     * Adds Vendure's error translation middleware to MCP routes, so callers receive translated
     * error messages instead of i18n keys. With local trust on, it also adds the middleware that
     * accepts the local-trust secret on the Admin API path.
     */
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(this.i18nService.handle()).forRoutes('mcp/shop', 'mcp/admin');
        if (McpPlugin.localTrustState.activation.enabled) {
            consumer
                .apply(this.localTrust.adminApiMiddleware())
                .forRoutes(this.configService.apiOptions.adminApiPath);
        }
    }

    /**
     * Reads the CLI's local-trust secret, deletes it from `process.env`, and decides whether local
     * trust is on. The configuration hooks of later plugins, the app itself and any process
     * spawned after this point do not inherit the secret. The Admin API only reads a bearer token
     * when the token method includes `'bearer'`, so it is added when local trust is on.
     *
     * @internal
     */
    static activateLocalTrust(config: RuntimeVendureConfig): void {
        if (process.env[LOCAL_TRUST_SECRET_ENV_VAR] !== undefined) {
            McpPlugin.localTrustState.processRead = readLocalTrustActivation({
                localTrust: McpPlugin.options.localTrust,
                env: process.env,
                projectDir: process.cwd(),
                uid: process.getuid?.(),
                platform: process.platform,
            });
        }
        // An app configured with localTrust: false never uses what an earlier run read.
        const activation = McpPlugin.options.localTrust
            ? McpPlugin.localTrustState.processRead
            : LOCAL_TRUST_OFF;
        McpPlugin.localTrustState.activation = activation;
        McpPlugin.addedBearerTokenMethod = false;
        if (!activation.enabled) {
            return;
        }
        const tokenMethod = config.authOptions.tokenMethod ?? 'cookie';
        const methods = typeof tokenMethod === 'string' ? [tokenMethod] : [...tokenMethod];
        if (!methods.includes('bearer')) {
            config.authOptions.tokenMethod = [...methods, 'bearer'];
            McpPlugin.addedBearerTokenMethod = true;
        }
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
     * Builds the MCP message schemas up front, so the cost lands on startup rather than the
     * first request, then checks the configured options for anything invalid or unsafe for a
     * production server. Runs at startup, main server process only.
     */
    onApplicationBootstrap(): void {
        // Only the main server serves the OAuth routes, so only it needs this check.
        if (!this.processContext.isServer) {
            return;
        }
        preloadSchemas();
        checkMcpPluginOptions(McpPlugin.options);
        if (McpPlugin.addedBearerTokenMethod) {
            Logger.info(
                "Local trust added 'bearer' to authOptions.tokenMethod, so the Admin API accepts " +
                    'the local-trust secret. Every Admin and Shop API request on this server may now ' +
                    'authenticate with a bearer token.',
                loggerCtx,
            );
        }
    }
}
