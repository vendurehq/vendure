import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { AuthInfo, createMcpHandler, isJsonContentType } from '@modelcontextprotocol/server';
import {
    Body,
    Controller,
    Get,
    Headers,
    Inject,
    NotFoundException,
    Post,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import type { Request, Response } from 'express';

import { MCP_PLUGIN_OPTIONS, RATE_LIMIT_ERROR_CODE } from '../constants';
import { McpExecutionContext } from '../internal-types';
import { McpOauthService } from '../oauth/oauth.service';
import { McpRateLimiterService, McpRateLimitExceededError } from '../rate-limit/mcp-rate-limiter.service';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';
import { McpPluginOptions } from '../types';

import { createMcpServerForRequest } from './mcp-server.factory';

/** A Node `(req, res, parsedBody?)` handler as produced by `toNodeHandler`. */
type NodeMcpHandler = (req: Request, res: Response, parsedBody?: unknown) => Promise<void>;

/** A `(req, res) => boolean` DNS-rebinding front guard (writes its own 403 on rejection). */
type FrontGuard = (req: Request, res: Response) => boolean;

/** Minimal JSON-RPC error envelope returned by the handshake pre-check. */
interface JsonRpcError {
    jsonrpc: '2.0';
    id: string | number | null;
    error: { code: number; message: string; data?: unknown };
}

/**
 * @description
 * HTTP transport for the MCP server. Owns authentication, anonymous shop context, the anonymous-IP
 * gate and the handshake rate-limit pre-check (both kept at controller altitude so the `-31029`
 * `error.data` survives), and the DNS-rebinding front guard. It then delegates JSON-RPC handling to the v2 SDK handler via
 * `toNodeHandler`, passing the resolved Vendure context through the SDK's pass-through `authInfo`.
 */
@Controller('mcp')
export class McpTransportController {
    private readonly nodeHandler: NodeMcpHandler;
    private readonly hostGuard?: FrontGuard;
    private readonly originGuard?: FrontGuard;

    constructor(
        private oauthService: McpOauthService,
        private registry: McpToolRegistryService,
        private rateLimiter: McpRateLimiterService,
        private configService: ConfigService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: McpPluginOptions,
    ) {
        // One stateless handler; the per-request factory reads the resolved context from authInfo.extra.
        const handler = createMcpHandler(async mcpCtx => {
            const extra = mcpCtx.authInfo?.extra as
                | { executionContext?: McpExecutionContext; toolset?: McpToolset }
                | undefined;
            if (!extra?.executionContext || !extra.toolset) {
                throw new Error('MCP request is missing its resolved execution context');
            }
            return createMcpServerForRequest(extra.executionContext, extra.toolset, this.registry);
        });
        this.nodeHandler = toNodeHandler(handler);
        const dns = this.options.dnsRebinding;
        this.hostGuard = dns?.allowedHosts?.length
            ? (hostHeaderValidation(dns.allowedHosts) as FrontGuard)
            : undefined;
        this.originGuard = dns?.allowedOrigins?.length
            ? (originValidation(dns.allowedOrigins) as FrontGuard)
            : undefined;
    }

    @Post('shop')
    async postShop(
        @Req() req: Request,
        @Res() res: Response,
        @Body() body: unknown,
        @Headers() headers: Record<string, string | string[] | undefined>,
    ): Promise<void> {
        if (this.options.shopAccess === 'disabled') {
            throw new NotFoundException();
        }
        return this.handlePost('shop', req, res, body, headers);
    }

    @Post('admin')
    async postAdmin(
        @Req() req: Request,
        @Res() res: Response,
        @Body() body: unknown,
        @Headers() headers: Record<string, string | string[] | undefined>,
    ): Promise<void> {
        return this.handlePost('admin', req, res, body, headers);
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
        req: Request,
        res: Response,
        body: unknown,
        headers: Record<string, string | string[] | undefined>,
    ): Promise<void> {
        // 1. DNS-rebinding front guard (writes its own 403 and returns false on rejection).
        if (this.hostGuard && !this.hostGuard(req, res)) {
            return;
        }
        if (this.originGuard && !this.originGuard(req, res)) {
            return;
        }

        const token = this.getBearerToken(this.getHeader(headers, 'authorization'));

        if (toolset === 'shop' && this.options.shopAccess === 'authenticated' && !token) {
            this.setAuthChallenge(res, 'shop');
            throw new UnauthorizedException('Shop MCP endpoint requires a Bearer token');
        }

        // 3. Meter anonymous shop traffic by IP before anything else touches the database. Building
        // the context below creates a Vendure session row when the caller has no usable session, so the
        // write has to sit inside the limit rather than behind it.
        if (toolset === 'shop' && !token) {
            try {
                await this.rateLimiter.enforceAnonymousIpRateLimit(toolset, this.getClientIp(req));
            } catch (e) {
                if (!(e instanceof McpRateLimitExceededError)) {
                    throw e;
                }
                this.sendRateLimitError(res, body, e);
                return;
            }
        }

        // 4. Authenticate and build the execution context.
        let executionContext: McpExecutionContext;
        if (toolset === 'admin') {
            if (!token) {
                this.setAuthChallenge(res, 'admin');
                throw new UnauthorizedException('Admin MCP endpoint requires a Bearer token');
            }
            const authContext = await this.authenticateBearerToken(token, 'admin', res);
            executionContext = { ...authContext, clientIp: this.getClientIp(req) };
        } else if (token) {
            const authContext = await this.authenticateBearerToken(token, 'shop', res);
            executionContext = { ...authContext, clientIp: this.getClientIp(req) };
        } else {
            // Anonymous shop: thread the Vendure session token (for cart continuity) and the channel
            // token (for multi-channel). An invalid channel token errors like the rest of Vendure.
            const ctx = await this.oauthService.createAnonymousShopContext(
                this.getVendureSessionToken(headers),
                this.getChannelToken(headers),
            );
            // Echo the session token BEFORE delegating — the SDK handler owns the response write.
            // (If a future SDK path resets headers, hook res.writeHead here instead.)
            this.setVendureSessionToken(res, ctx.session?.token);
            executionContext = { ctx, clientIp: this.getClientIp(req) };
        }

        // 5. Handshake rate-limit pre-check (only meaningful for JSON bodies we can parse).
        const contentType = this.getHeader(headers, 'content-type') ?? '';
        const isJson = isJsonContentType(contentType);
        const parsedBody = isJson ? body : undefined;
        if (isJson) {
            const exceeded = await this.preCheckHandshakeRateLimit(body, toolset, executionContext);
            if (exceeded) {
                this.sendRateLimitError(res, body, exceeded);
                return;
            }
        }

        // 6. Attach the resolved context as pass-through authInfo and delegate to the SDK handler.
        (req as Request & { auth?: AuthInfo }).auth = this.buildAuthInfo(executionContext, toolset, token);
        await this.nodeHandler(req, res, parsedBody);
    }

    /**
     * Enforces the per-subject rate limit for every method except `tools/call`, which the registry
     * funnel owns. Notifications are charged too: they carry no id and get no reply, but they still
     * reach the transport, so leaving them free left the endpoint hammerable for nothing.
     */
    private async preCheckHandshakeRateLimit(
        body: unknown,
        toolset: McpToolset,
        executionContext: McpExecutionContext,
    ): Promise<McpRateLimitExceededError | undefined> {
        const messages = Array.isArray(body) ? body : [body];
        for (const message of messages) {
            const method = (message as { method?: unknown } | null)?.method;
            if (typeof method !== 'string' || method === 'tools/call') {
                continue;
            }
            try {
                await this.rateLimiter.enforceRateLimit({
                    executionContext,
                    endpoint: toolset,
                    toolNames: [method],
                    subject: method,
                });
            } catch (e) {
                if (e instanceof McpRateLimitExceededError) {
                    return e;
                }
                throw e;
            }
        }
        return undefined;
    }

    /**
     * Sends a rate-limit response:
     * HTTP 429 with a `Retry-After` header, plus a JSON-RPC error body.
     * The 429 status lets proxies and monitoring treat this as a proper refusal.
     * The JSON-RPC body includes retry details for MCP-aware clients.
     */
    private sendRateLimitError(res: Response, body: unknown, error: McpRateLimitExceededError): void {
        const id = this.firstRequestId(body);
        res.status(429);
        res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
        res.setHeader('Content-Type', 'application/json');
        const payload: JsonRpcError = {
            jsonrpc: '2.0',
            id: id ?? null,
            error: {
                code: RATE_LIMIT_ERROR_CODE,
                message: error.message,
                data: {
                    retryAfterSeconds: error.details.retryAfterSeconds,
                    scope: error.details.scope,
                },
            },
        };
        res.send(JSON.stringify(payload));
    }

    /** The id of the first message that carries one, or `undefined` if the body is all notifications. */
    private firstRequestId(body: unknown): string | number | null | undefined {
        const messages = Array.isArray(body) ? body : [body];
        for (const message of messages) {
            const id = (message as { id?: unknown } | null)?.id;
            if (id !== undefined) {
                return id as string | number | null;
            }
        }
        return undefined;
    }

    private buildAuthInfo(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        token?: string,
    ): AuthInfo {
        const grant = executionContext.grant;
        return {
            // Pass-through only — the SDK performs no token verification.
            token: token ?? 'anonymous',
            clientId: grant?.oauthClientId != null ? String(grant.oauthClientId) : 'anonymous',
            scopes: [],
            expiresAt: grant?.accessTokenExpiresAt
                ? Math.floor(new Date(grant.accessTokenExpiresAt).getTime() / 1000)
                : undefined,
            extra: { executionContext, toolset },
        };
    }

    private async authenticateBearerToken(token: string, toolset: McpToolset, res: Response) {
        try {
            return await this.oauthService.authenticateBearerToken(token, toolset);
        } catch (e) {
            if (e instanceof UnauthorizedException) {
                this.setAuthChallenge(res, toolset);
            }
            throw e;
        }
    }

    private setAuthChallenge(res: Response, toolset: McpToolset): void {
        res.setHeader(
            'WWW-Authenticate',
            `Bearer resource_metadata="${this.oauthService.protectedResourceMetadataUrl(toolset)}"`,
        );
    }

    private methodNotAllowed(res: Response): void {
        res.setHeader('Allow', 'POST');
        res.status(405).send('Method Not Allowed');
    }

    private getBearerToken(header?: string): string | undefined {
        const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
        return match?.[1];
    }

    private getClientIp(req: Request): string | undefined {
        return req.ip ?? req.socket?.remoteAddress ?? undefined;
    }

    private getVendureSessionToken(
        headers: Record<string, string | string[] | undefined>,
    ): string | undefined {
        const key = this.configService.authOptions.authTokenHeaderKey ?? 'vendure-auth-token';
        const value = this.getHeader(headers, key);
        return value || undefined;
    }

    private setVendureSessionToken(res: Response, token?: string): void {
        if (token) {
            res.setHeader(this.configService.authOptions.authTokenHeaderKey ?? 'vendure-auth-token', token);
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
        const lower = name.toLowerCase();
        const direct = headers[lower];
        const value = direct ?? Object.entries(headers).find(([key]) => key.toLowerCase() === lower)?.[1];
        return Array.isArray(value) ? value[0] : value;
    }
}
