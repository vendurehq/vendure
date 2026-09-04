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
} from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import type { Request, Response } from 'express';

import { loggerCtx, MCP_PLUGIN_OPTIONS, RATE_LIMIT_ERROR_CODE } from '../constants';
import { getClientIp } from '../get-client-ip';
import { getLanguageCodeFromQuery } from '../get-language-code';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpAccessTokenExpiredError } from '../oauth/oauth-error';
import { McpOauthMetadataService } from '../oauth/oauth-metadata.service';
import { McpOauthService } from '../oauth/oauth.service';
import { McpRateLimiterService, McpRateLimitExceeded } from '../rate-limit/mcp-rate-limiter.service';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';
import { McpShopSessionService } from '../shop-session/mcp-shop-session.service';

import { createMcpServerForRequest } from './mcp-server.factory';

// Deliberately not a valid tool or method name, so it never collides with a real one.
const MALFORMED_SUBJECT = 'malformed';

/** Minimal JSON-RPC error envelope returned by the handshake pre-check. */
interface JsonRpcError {
    jsonrpc: '2.0';
    id: string | number | null;
    error: { code: number; message: string; data?: unknown };
}

/** The fields this controller reads off a caller's message before the SDK parses it. */
interface JsonRpcMessage {
    method?: unknown;
    id?: unknown;
    params?: { name?: unknown };
}

// Converts an invalid channel token to a 400 instead of a 500, keeping Vendure's default response format and logging.
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
                `The ${this.channelTokenHeader} query parameter or header does not name a sales channel of this server.`,
            ),
            host,
        );
    }
}

/**
 * @description
 * HTTP transport for the MCP server. Owns authentication, anonymous shop context, the DNS-rebinding
 * front guard, and the anonymous-IP and handshake rate-limit checks (kept here, rather than in the
 * SDK handler, so the `-31029` `error.data` survives). It then delegates JSON-RPC handling to the
 * v2 SDK handler via `toNodeHandler`, passing the resolved Vendure context through the SDK's
 * pass-through `authInfo`.
 */
@UseFilters(McpChannelTokenExceptionFilter)
@Controller('mcp')
export class McpTransportController {
    private readonly nodeHandler: NodeMcpRequestHandler;
    private readonly hostGuard?: ReturnType<typeof hostHeaderValidation>;
    private readonly originGuard?: ReturnType<typeof originValidation>;

    constructor(
        private readonly oauthService: McpOauthService,
        private readonly registry: McpToolRegistryService,
        private readonly rateLimiter: McpRateLimiterService,
        private readonly configService: ConfigService,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
        private readonly shopSession: McpShopSessionService,
        private readonly channelService: ChannelService,
        private readonly oauthMetadata: McpOauthMetadataService,
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

    /** The shop endpoint answers 404 on every verb while shop access is switched off. */
    private assertShopEnabled(): void {
        if (this.options.shopAccess === 'disabled') {
            throw new NotFoundException();
        }
    }

    @Post('shop')
    async postShop(@Req() req: I18nRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
        this.assertShopEnabled();
        return this.handlePost('shop', req, res, body);
    }

    @Post('admin')
    async postAdmin(@Req() req: I18nRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
        return this.handlePost('admin', req, res, body);
    }

    @Get('shop')
    getShop(@Res() res: Response): void {
        this.assertShopEnabled();
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
        if (this.blockedByDnsRebindingGuard(req, res)) {
            return;
        }

        const token = this.getBearerToken(this.getHeader(req.headers, 'authorization'));
        const clientIp = getClientIp(req);

        const executionContext = await this.resolveCaller(toolset, req, res, body, token, clientIp);
        if (!executionContext) {
            return;
        }

        const isJson = isJsonContentType(this.getHeader(req.headers, 'content-type') ?? '');
        if (await this.refusedBeforeDispatch(toolset, res, body, isJson, executionContext)) {
            return;
        }

        (req as Request & { auth?: AuthInfo }).auth = this.buildAuthInfo(executionContext, toolset, token);
        await this.nodeHandler(req, res, isJson ? body : undefined);
    }

    /** Each guard writes its own 403 response and returns false when it rejects. */
    private blockedByDnsRebindingGuard(req: I18nRequest, res: Response): boolean {
        if (this.hostGuard && !this.hostGuard(req, res)) {
            return true;
        }
        if (this.originGuard && !this.originGuard(req, res)) {
            return true;
        }
        return false;
    }

    /** The refusals that come after the caller is known. Returns true once one has written the response. */
    private async refusedBeforeDispatch(
        toolset: McpToolset,
        res: Response,
        body: unknown,
        isJson: boolean,
        executionContext: McpExecutionContext,
    ): Promise<boolean> {
        // Charged even for a body the SDK will refuse, since resolving the caller already cost a database round trip.
        const preCheckExceeded = await this.preCheckHandshakeRateLimit(body, toolset, executionContext);
        if (preCheckExceeded) {
            this.sendRateLimitError(res, body, preCheckExceeded);
            return true;
        }
        if (isJson && this.callsSubscriptionsListen(body)) {
            this.sendSubscriptionsUnsupported(res, body);
            return true;
        }
        return false;
    }

    /** Returns undefined when it has already written the refusal response, rather than a caller. */
    private async resolveCaller(
        toolset: McpToolset,
        req: I18nRequest,
        res: Response,
        body: unknown,
        token: string | undefined,
        clientIp: string | undefined,
    ): Promise<McpExecutionContext | undefined> {
        if (toolset === 'shop' && this.options.shopAccess === 'authenticated' && !token) {
            this.setAuthChallenge(res, 'shop');
            throw new UnauthorizedException('Shop MCP endpoint requires a Bearer token');
        }

        if (await this.refusedByPreAuthRateLimits(toolset, res, body, token, clientIp)) {
            return undefined;
        }

        if (toolset === 'admin' && !token) {
            this.setAuthChallenge(res, 'admin');
            throw new UnauthorizedException('Admin MCP endpoint requires a Bearer token');
        }

        if (token) {
            const authContext = await this.authenticateBearerToken(token, toolset, req, res, clientIp);
            return { ...authContext, clientIp };
        }
        return this.anonymousShopExecutionContext(req, res, clientIp);
    }

    private async refusedByPreAuthRateLimits(
        toolset: McpToolset,
        res: Response,
        body: unknown,
        token: string | undefined,
        clientIp: string | undefined,
    ): Promise<boolean> {
        // Rate-limit anonymous shop requests by IP before accessing the database.
        if (toolset === 'shop' && !token) {
            const exceeded = await this.rateLimiter.checkAnonymousIpRateLimit(toolset, clientIp);
            if (exceeded) {
                this.sendRateLimitError(res, body, exceeded);
                return true;
            }
        }

        // Checked before the token is looked up, so a flood of made-up tokens does not cost a database query each.
        if (token) {
            const exceeded = await this.rateLimiter.checkBearerAuthFailureRateLimit(clientIp);
            if (exceeded) {
                this.sendRateLimitError(res, body, exceeded);
                return true;
            }
        }

        return false;
    }

    // Most MCP clients cannot persist headers, so the session token usually arrives as a tool argument.
    private async anonymousShopExecutionContext(
        req: I18nRequest,
        res: Response,
        clientIp: string | undefined,
    ): Promise<McpExecutionContext> {
        try {
            const ctx = await this.createAnonymousShopContext(
                req,
                this.getVendureSessionToken(req.headers),
                this.getChannelToken(req),
            );
            // Preserve the session token from the header in the response so the client can reuse it.
            this.setVendureSessionToken(res, ctx.session?.token);
            return { ctx, clientIp };
        } catch (e) {
            if (e instanceof UnauthorizedException) {
                this.setAuthChallenge(res, 'shop');
            }
            throw e;
        }
    }

    /** True when any message in the body asks to open a subscription stream. */
    private callsSubscriptionsListen(body: unknown): boolean {
        const messages = Array.isArray(body) ? body : [body];
        return messages.some(message => this.isMessage(message) && message.method === 'subscriptions/listen');
    }

    // Refused because this plugin never publishes a notification, so such a stream could only ever deliver keep-alive pings.
    private sendSubscriptionsUnsupported(res: Response, body: unknown): void {
        // -32601 with HTTP 404 is exactly how the SDK answers a method it does not implement.
        this.sendRefusal(res, 404, { code: -32601, message: 'Method not found: subscriptions/listen' }, body);
    }

    // Notifications are charged too, since they still reach the transport even though they get no reply.
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
            const method = this.isMessage(message) ? message.method : undefined;
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

    /** A call missing `params` or a tool name never reaches the registry, so it must be charged here instead. */
    private isRegistryChargedToolCall(message: unknown): boolean {
        return (
            this.isMessage(message) &&
            message.method === 'tools/call' &&
            typeof message.params?.name === 'string'
        );
    }

    // HTTP 429 lets proxies and monitoring treat this as a proper refusal; the JSON-RPC body adds retry details for MCP-aware clients.
    private sendRateLimitError(res: Response, body: unknown, exceeded: McpRateLimitExceeded): void {
        res.setHeader('Retry-After', String(exceeded.retryAfterSeconds));
        this.sendRefusal(
            res,
            429,
            {
                code: RATE_LIMIT_ERROR_CODE,
                message: exceeded.message,
                data: {
                    retryAfterSeconds: exceeded.retryAfterSeconds,
                    scope: exceeded.scope,
                },
            },
            body,
        );
    }

    /** Answers a request the SDK never sees: a JSON-RPC error per addressable message, with the given HTTP status. */
    private sendRefusal(res: Response, status: number, error: JsonRpcError['error'], body: unknown): void {
        res.status(status);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(this.refusalPayload(body, error)));
    }

    /** One error per message when the body is a batch, so the client can match each refusal to its request. */
    private refusalPayload(body: unknown, error: JsonRpcError['error']): JsonRpcError | JsonRpcError[] {
        if (Array.isArray(body)) {
            const errors = body
                .filter(message => this.hasRequestId(message))
                .map(message => ({
                    jsonrpc: '2.0' as const,
                    id: this.requestId(message),
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
        return this.usableId(message) !== undefined;
    }

    private requestId(message: unknown): string | number | null {
        return this.usableId(message) ?? null;
    }

    /** Narrows an unparsed body entry to an object whose fields can be read; a primitive is not a message. */
    private isMessage(value: unknown): value is JsonRpcMessage {
        return typeof value === 'object' && value !== null;
    }

    private usableId(message: unknown): string | number | null | undefined {
        if (!this.isMessage(message)) {
            return undefined;
        }
        const { id } = message;
        return typeof id === 'string' || typeof id === 'number' || id === null ? id : undefined;
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
                // An access token that reached the end of its lifetime is answered by refreshing,
                // so it is not a failed authentication attempt and must not spend the budget that
                // is there to stop token guessing.
                if (!(e instanceof McpAccessTokenExpiredError)) {
                    await this.rateLimiter.recordBearerAuthFailure(clientIp);
                }
                this.setAuthChallenge(res, toolset, { invalidToken: true, description: e.message });
            }
            throw e;
        }
    }

    // Per RFC 6750 §3.1: a bare challenge means no credentials were sent, while `error="invalid_token"` means one was sent and rejected.
    private setAuthChallenge(
        res: Response,
        toolset: McpToolset,
        options?: { invalidToken?: boolean; description?: string },
    ): void {
        const params = [`resource_metadata="${this.oauthMetadata.protectedResourceMetadataUrl(toolset)}"`];
        if (options?.invalidToken) {
            params.push('error="invalid_token"');
            if (options.description) {
                // A header parameter is a quoted string, so only printable ASCII without a quote or backslash can go inside it.
                const description = options.description.replace(/[^\x20-\x7e]|["\\]/g, '');
                params.push(`error_description="${description}"`);
            }
        }
        res.setHeader('WWW-Authenticate', `Bearer ${params.join(', ')}`);
    }

    private methodNotAllowed(res: Response): void {
        res.setHeader('Allow', 'POST');
        res.status(405).send('Method Not Allowed');
    }

    private getBearerToken(header?: string): string | undefined {
        if (header === undefined) {
            return undefined;
        }
        if (header.slice(0, 6).toLowerCase() !== 'bearer') {
            return undefined;
        }
        const afterScheme = header.slice(6);
        // "Bearerabc" is not a bearer header: the scheme has to be separated from the token.
        if (!/^\s/.test(afterScheme)) {
            return undefined;
        }
        const tokenStart = afterScheme.search(/\S/);
        if (tokenStart === -1) {
            return undefined;
        }
        return afterScheme.slice(tokenStart);
    }

    private async createAnonymousShopContext(
        req: I18nRequest,
        sessionToken?: string,
        channelToken?: string,
    ): Promise<RequestContext> {
        const resolution = await this.shopSession.resolveHeaderToken(sessionToken);
        if (resolution.kind === 'refused') {
            throw new UnauthorizedException(resolution.message);
        }
        const channel = await this.channelService.getChannelFromToken(channelToken ?? '');
        return new RequestContext({
            apiType: 'shop',
            channel,
            languageCode: getLanguageCodeFromQuery(req),
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

    /** Same precedence as core's RequestContextService: the query parameter wins over the header. */
    private getChannelToken(req: I18nRequest): string | undefined {
        const key = this.configService.apiOptions.channelTokenKey;
        const fromQuery = req.query?.[key];
        if (typeof fromQuery === 'string' && fromQuery) {
            return fromQuery;
        }
        const value = this.getHeader(req.headers, key);
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
