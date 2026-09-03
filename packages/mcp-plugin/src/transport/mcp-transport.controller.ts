import {
    hostHeaderValidation,
    type NodeMcpRequestHandler,
    originValidation,
    toNodeHandler,
} from '@modelcontextprotocol/node';
import { AuthInfo, createMcpHandler, isJsonContentType } from '@modelcontextprotocol/server';
import {
    ArgumentsHost,
    BadRequestException,
    Body,
    Catch,
    Controller,
    Get,
    Inject,
    NotFoundException,
    Post,
    Req,
    Res,
    UnauthorizedException,
    UseFilters,
} from '@nestjs/common';
import {
    ChannelNotFoundError,
    ChannelService,
    ConfigService,
    ExceptionLoggerFilter,
    I18nRequest,
    Logger,
    RequestContext,
    RequestContextService,
} from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import type { Request, Response } from 'express';

import { loggerCtx, MCP_PLUGIN_OPTIONS, RATE_LIMIT_ERROR_CODE } from '../constants';
import { getClientIp } from '../get-client-ip';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpOauthService } from '../oauth/oauth.service';
import { McpRateLimiterService, McpRateLimitExceeded } from '../rate-limit/mcp-rate-limiter.service';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';
import { McpShopSessionService } from '../shop-session/mcp-shop-session.service';

import { createMcpServerForRequest } from './mcp-server.factory';

/**
 * The rate-limit subject used for a request body the SDK will refuse (no JSON-RPC method, or a
 * non-JSON content type). Deliberately not a valid tool or method name.
 */
const MALFORMED_SUBJECT = 'malformed';

/** Minimal JSON-RPC error envelope returned by the handshake pre-check. */
interface JsonRpcError {
    jsonrpc: '2.0';
    id: string | number | null;
    error: { code: number; message: string; data?: unknown };
}

/**
 * Converts an invalid channel token to a 400 instead of a 500.
 * Keeps Vendure's default response format and logging.
 */
@Catch(ChannelNotFoundError)
export class McpChannelTokenExceptionFilter extends ExceptionLoggerFilter {
    private readonly channelTokenHeader: string;

    constructor(configService: ConfigService) {
        super(configService);
        this.channelTokenHeader = configService.apiOptions.channelTokenKey;
    }

    catch(exception: ChannelNotFoundError, host: ArgumentsHost) {
        return super.catch(
            new BadRequestException(
                `The ${this.channelTokenHeader} header does not name a sales channel of this server.`,
            ),
            host,
        );
    }
}

/**
 * @description
 * HTTP transport for the MCP server. Owns authentication, anonymous shop context, the anonymous-IP
 * gate and the handshake rate-limit pre-check (both kept at controller altitude so the `-31029`
 * `error.data` survives), and the DNS-rebinding front guard. It then delegates JSON-RPC handling to the v2 SDK handler via
 * `toNodeHandler`, passing the resolved Vendure context through the SDK's pass-through `authInfo`.
 */
@UseFilters(McpChannelTokenExceptionFilter)
@Controller('mcp')
export class McpTransportController {
    private readonly nodeHandler: NodeMcpRequestHandler;
    private readonly hostGuard?: ReturnType<typeof hostHeaderValidation>;
    private readonly originGuard?: ReturnType<typeof originValidation>;

    constructor(
        private oauthService: McpOauthService,
        private registry: McpToolRegistryService,
        private rateLimiter: McpRateLimiterService,
        private configService: ConfigService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
        private requestContextService: RequestContextService,
        private shopSession: McpShopSessionService,
        private channelService: ChannelService,
    ) {
        const handler = createMcpHandler(
            async mcpCtx => {
                const extra = mcpCtx.authInfo?.extra as
                    | { executionContext?: McpExecutionContext; toolset?: McpToolset }
                    | undefined;
                if (!extra?.executionContext || !extra.toolset) {
                    throw new Error('MCP request is missing its resolved execution context');
                }
                return createMcpServerForRequest(extra.executionContext, extra.toolset, this.registry);
            },
            {
                onerror: error => {
                    // JSON.stringify escapes caller text to prevent log forgery
                    Logger.error(`MCP request handling failed: ${JSON.stringify(error.message)}`, loggerCtx);
                },
            },
        );
        this.nodeHandler = toNodeHandler(handler, {
            onerror: error => {
                Logger.error(`MCP transport adapter error: ${JSON.stringify(error.message)}`, loggerCtx);
            },
        });
        const dns = this.options.dnsRebinding;
        this.hostGuard = dns?.allowedHosts?.length ? hostHeaderValidation(dns.allowedHosts) : undefined;
        this.originGuard = dns?.allowedOrigins?.length ? originValidation(dns.allowedOrigins) : undefined;
    }

    @Post('shop')
    async postShop(@Req() req: I18nRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
        if (this.options.shopAccess === 'disabled') {
            throw new NotFoundException();
        }
        return this.handlePost('shop', req, res, body);
    }

    @Post('admin')
    async postAdmin(@Req() req: I18nRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
        return this.handlePost('admin', req, res, body);
    }

    @Get('shop')
    getShop(@Res() res: Response): void {
        if (this.options.shopAccess === 'disabled') {
            throw new NotFoundException();
        }
        this.methodNotAllowed(res);
    }

    @Get('admin')
    getAdmin(@Res() res: Response): void {
        this.methodNotAllowed(res);
    }

    private async handlePost(
        toolset: McpToolset,
        req: I18nRequest,
        res: Response,
        body: unknown,
    ): Promise<void> {
        // DNS-rebinding protection. Each guard writes its own 403 response and returns false when it rejects.
        if (this.hostGuard && !this.hostGuard(req, res)) {
            return;
        }
        if (this.originGuard && !this.originGuard(req, res)) {
            return;
        }

        const token = this.getBearerToken(this.getHeader(req.headers, 'authorization'));
        const clientIp = getClientIp(req);

        if (toolset === 'shop' && this.options.shopAccess === 'authenticated' && !token) {
            this.setAuthChallenge(res, 'shop');
            throw new UnauthorizedException('Shop MCP endpoint requires a Bearer token');
        }

        // Rate-limit anonymous shop requests by IP before accessing the database.
        if (toolset === 'shop' && !token) {
            const exceeded = await this.rateLimiter.checkAnonymousIpRateLimit(toolset, clientIp);
            if (exceeded) {
                this.sendRateLimitError(res, body, exceeded);
                return;
            }
        }

        // Refuse an IP that has used up its failed-authentication allowance before the token is
        // looked up, so a flood of made-up tokens does not cost a database query each.
        if (token) {
            const exceeded = await this.rateLimiter.checkBearerAuthFailureRateLimit(clientIp);
            if (exceeded) {
                this.sendRateLimitError(res, body, exceeded);
                return;
            }
        }

        if (toolset === 'admin' && !token) {
            this.setAuthChallenge(res, 'admin');
            throw new UnauthorizedException('Admin MCP endpoint requires a Bearer token');
        }

        let executionContext: McpExecutionContext;
        if (token) {
            const authContext = await this.authenticateBearerToken(token, toolset, req, res, clientIp);
            executionContext = { ...authContext, clientIp };
        } else {
            // A `vendure-auth-token` header can resume an anonymous session. Most MCP clients cannot
            // persist headers, so the session token is usually passed as a tool argument instead.
            try {
                const ctx = await this.createAnonymousShopContext(
                    req,
                    this.getVendureSessionToken(req.headers),
                    this.getChannelToken(req.headers),
                );
                // Preserve the session token from the header in the response so the client can reuse it.
                this.setVendureSessionToken(res, ctx.session?.token);
                executionContext = { ctx, clientIp };
            } catch (e) {
                if (e instanceof UnauthorizedException) {
                    this.setAuthChallenge(res, 'shop');
                }
                throw e;
            }
        }

        const contentType = this.getHeader(req.headers, 'content-type') ?? '';
        const isJson = isJsonContentType(contentType);
        const parsedBody = isJson ? body : undefined;
        // Charged for every content type, including the ones the SDK will refuse: resolving the
        // caller above already cost a database round trip, so an unusable body must still be metered.
        const preCheckExceeded = await this.preCheckHandshakeRateLimit(body, toolset, executionContext);
        if (preCheckExceeded) {
            this.sendRateLimitError(res, body, preCheckExceeded);
            return;
        }

        if (isJson && this.callsSubscriptionsListen(body)) {
            this.sendSubscriptionsUnsupported(res, body);
            return;
        }

        (req as Request & { auth?: AuthInfo }).auth = this.buildAuthInfo(executionContext, toolset, token);
        await this.nodeHandler(req, res, parsedBody);
    }

    /** True when any message in the body asks to open a subscription stream. */
    private callsSubscriptionsListen(body: unknown): boolean {
        const messages = Array.isArray(body) ? body : [body];
        return messages.some(
            message => (message as { method?: unknown } | null)?.method === 'subscriptions/listen',
        );
    }

    /**
     * Tells the caller the subscription-stream method does not exist here.
     * The SDK would otherwise hold the connection open indefinitely, and this plugin never publishes
     * a notification, so such a stream can only ever deliver keep-alive pings. Remove this refusal
     * when the plugin starts publishing something worth streaming.
     */
    private sendSubscriptionsUnsupported(res: Response, body: unknown): void {
        res.status(404);
        res.setHeader('Content-Type', 'application/json');
        // -32601 with HTTP 404 is exactly how the SDK answers a method it does not implement.
        const payload = this.refusalPayload(body, {
            code: -32601,
            message: 'Method not found: subscriptions/listen',
        });
        res.send(JSON.stringify(payload));
    }

    /**
     * Enforces the per-subject rate limit for every message except a `tools/call` the registry
     * funnel will charge itself. Notifications are charged too: they carry no id and get no reply,
     * but they still reach the transport, so leaving them free left the endpoint hammerable for
     * nothing. A message the SDK cannot parse at all is charged under {@link MALFORMED_SUBJECT},
     * which is not a tool name, so no `perTool` limit can match it.
     */
    private async preCheckHandshakeRateLimit(
        body: unknown,
        toolset: McpToolset,
        executionContext: McpExecutionContext,
    ): Promise<McpRateLimitExceeded | undefined> {
        const messages = Array.isArray(body) ? body : [body];
        for (const message of messages) {
            if (this.isRegistryChargedToolCall(message)) {
                continue;
            }
            const method = (message as { method?: unknown } | null)?.method;
            const exceeded = await this.rateLimiter.checkRateLimit({
                executionContext,
                endpoint: toolset,
                subject: typeof method === 'string' ? method : MALFORMED_SUBJECT,
            });
            if (exceeded) {
                return exceeded;
            }
        }
        return undefined;
    }

    /**
     * True for a `tools/call` the tool registry will reach and charge itself. A call whose `params`
     * is missing, or carries no tool name, is rejected by the SDK before the registry runs, so it
     * has to be charged here instead.
     */
    private isRegistryChargedToolCall(message: unknown): boolean {
        const parsed = message as { method?: unknown; params?: { name?: unknown } } | null;
        return parsed?.method === 'tools/call' && typeof parsed.params?.name === 'string';
    }

    /**
     * Sends a rate-limit response:
     * HTTP 429 with a `Retry-After` header, plus a JSON-RPC error body.
     * The 429 status lets proxies and monitoring treat this as a proper refusal.
     * The JSON-RPC body includes retry details for MCP-aware clients.
     */
    private sendRateLimitError(res: Response, body: unknown, exceeded: McpRateLimitExceeded): void {
        res.status(429);
        res.setHeader('Retry-After', String(exceeded.retryAfterSeconds));
        res.setHeader('Content-Type', 'application/json');
        const payload = this.refusalPayload(body, {
            code: RATE_LIMIT_ERROR_CODE,
            message: exceeded.message,
            data: {
                retryAfterSeconds: exceeded.retryAfterSeconds,
                scope: exceeded.scope,
            },
        });
        res.send(JSON.stringify(payload));
    }

    /**
     * Builds the body that refuses a request before the SDK sees it: one error per message with an
     * id when the body is a batch, so the client can match each refusal, else a single error.
     */
    private refusalPayload(body: unknown, error: JsonRpcError['error']): JsonRpcError | JsonRpcError[] {
        if (Array.isArray(body)) {
            const errors = body
                .filter(message => this.hasRequestId(message))
                .map(message => ({
                    jsonrpc: '2.0' as const,
                    id: (message as { id: string | number | null }).id,
                    error,
                }));
            if (errors.length > 0) {
                return errors;
            }
        }
        return { jsonrpc: '2.0', id: this.requestId(body), error };
    }

    /** True when a message carries an id JSON-RPC allows, so a reply can be addressed to it. */
    private hasRequestId(message: unknown): boolean {
        const id = (message as { id?: unknown } | null)?.id;
        return typeof id === 'string' || typeof id === 'number' || id === null;
    }

    /** The message's own id, or `null` when it has none or one of an unusable type. */
    private requestId(message: unknown): string | number | null {
        return this.hasRequestId(message) ? (message as { id: string | number | null }).id : null;
    }

    private buildAuthInfo(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        token?: string,
    ): AuthInfo {
        const grant = executionContext.grant;
        return {
            // Pass-through only; the SDK does not verify this token.
            token: token ?? 'anonymous',
            clientId: grant?.oauthClientId != null ? String(grant.oauthClientId) : 'anonymous',
            scopes: [],
            expiresAt: grant?.accessTokenExpiresAt
                ? Math.floor(new Date(grant.accessTokenExpiresAt).getTime() / 1000)
                : undefined,
            extra: { executionContext, toolset },
        };
    }

    private async authenticateBearerToken(
        token: string,
        toolset: McpToolset,
        req: I18nRequest,
        res: Response,
        clientIp?: string,
    ) {
        try {
            return await this.oauthService.authenticateBearerToken(token, toolset, req);
        } catch (e) {
            if (e instanceof UnauthorizedException) {
                await this.rateLimiter.recordBearerAuthFailure(clientIp);
                this.setAuthChallenge(res, toolset, { invalidToken: true });
            }
            throw e;
        }
    }

    /**
     * Per RFC 6750 §3.1: a bare challenge means no credentials were sent, while `error="invalid_token"`
     * means a token was sent and rejected. Callers pass `invalidToken: true` only for the latter case.
     */
    private setAuthChallenge(res: Response, toolset: McpToolset, options?: { invalidToken?: boolean }): void {
        const resourceMetadata = `resource_metadata="${this.oauthService.protectedResourceMetadataUrl(toolset)}"`;
        const challenge = options?.invalidToken
            ? `Bearer ${resourceMetadata}, error="invalid_token"`
            : `Bearer ${resourceMetadata}`;
        res.setHeader('WWW-Authenticate', challenge);
    }

    private methodNotAllowed(res: Response): void {
        res.setHeader('Allow', 'POST');
        res.status(405).send('Method Not Allowed');
    }

    private getBearerToken(header?: string): string | undefined {
        const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
        return match?.[1];
    }

    private async createAnonymousShopContext(
        req: I18nRequest,
        sessionToken?: string,
        channelToken?: string,
    ): Promise<RequestContext> {
        const resolution = await this.shopSession.resolveHeaderToken(sessionToken);
        if ('refusal' in resolution) {
            throw new UnauthorizedException(resolution.refusal);
        }
        const adminCtx = await this.requestContextService.create({ apiType: 'admin' });
        const channel = channelToken
            ? await this.channelService.getChannelFromToken(adminCtx, channelToken)
            : await this.channelService.getDefaultChannel(adminCtx);
        return new RequestContext({
            apiType: 'shop',
            channel,
            session: resolution.session,
            isAuthorized: false,
            authorizedAsOwnerOnly: true,
            req,
            translationFn: req.t,
        });
    }

    private getVendureSessionToken(
        headers: Record<string, string | string[] | undefined>,
    ): string | undefined {
        const key = this.configService.authOptions.authTokenHeaderKey;
        const value = this.getHeader(headers, key);
        return value || undefined;
    }

    private setVendureSessionToken(res: Response, token?: string): void {
        if (token) {
            res.setHeader(this.configService.authOptions.authTokenHeaderKey, token);
        }
    }

    private getChannelToken(headers: Record<string, string | string[] | undefined>): string | undefined {
        const key = this.configService.apiOptions.channelTokenKey;
        const value = this.getHeader(headers, key);
        return value || undefined;
    }

    private getHeader(
        headers: Record<string, string | string[] | undefined>,
        name: string,
    ): string | undefined {
        const value = headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
    }
}
