import {
    Inject,
    Injectable,
    OnApplicationBootstrap,
    OnApplicationShutdown,
    UnauthorizedException,
} from '@nestjs/common';
import { MCP_ADMIN_ENDPOINT_LOG_PREFIX } from '@vendure/common/lib/log';
import {
    AuthenticatedSession,
    ConfigService,
    I18nRequest,
    Logger,
    ProcessContext,
    RequestContext,
    RequestContextService,
    Session,
    SessionService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { loggerCtx, MCP_LOCAL_TRUST_ACTIVATION } from '../constants';
import { getBearerToken } from '../get-bearer-token';
import { getClientIp } from '../get-client-ip';
import { getLanguageCodeFromQuery } from '../get-language-code';
import { deleteCachedVendureSession } from '../oauth/oauth-utils';
import { McpRateLimiterService } from '../rate-limit/mcp-rate-limiter.service';
import { isLoopbackHostname } from '../shared/loopback';

import { hashLocalTrustSecret, LocalTrustActivation } from './local-trust-activation';
import { isLoopbackSocketAddress } from './loopback-socket-address';

/** The authentication strategy name recorded on the Admin API session that local trust creates. */
export const LOCAL_TRUST_SESSION_STRATEGY = 'local-trust';

/** What `AuthInfo.token` carries for a local-trust caller, in place of the secret. */
export const LOCAL_TRUST_AUTH_TOKEN_PLACEHOLDER = 'local-trust';

/**
 * A request carrying any of these came through a proxy or sidecar, which connects from loopback
 * with a local `Host`, so the loopback checks alone would let remote traffic through.
 */
const FORWARDED_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'via'] as const;

/**
 * The shape of the CLI's secret: 32 random bytes as base64url. A Vendure session token is 64 hex
 * characters, so it never has this shape. Only a bearer token of this shape counts as a failed
 * local-trust attempt on the Admin API, where every other bearer token is an ordinary session.
 */
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export interface LocalTrustRequest {
    socketAddress: string | undefined;
    headers: Record<string, string | string[] | undefined>;
}

/**
 * Accepts the per-run secret the Vendure CLI gives a dev server, on `POST /mcp/admin` and on the
 * Admin API path. Whether local trust is on at all is decided once at startup by
 * {@link readLocalTrustActivation}. This service applies the per-request checks.
 */
@Injectable()
export class LocalTrustService implements OnApplicationBootstrap, OnApplicationShutdown {
    private superadmin?: User;
    private adminApiSession?: Promise<string>;

    constructor(
        @Inject(MCP_LOCAL_TRUST_ACTIVATION) private readonly activation: LocalTrustActivation,
        private readonly processContext: ProcessContext,
        private readonly configService: ConfigService,
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly sessionService: SessionService,
        private readonly rateLimiter: McpRateLimiterService,
    ) {}

    /** @internal */
    async onApplicationBootstrap(): Promise<void> {
        if (!this.processContext.isServer) {
            return;
        }
        // The Vendure CLI reads this line to find the endpoint, so keep its format stable.
        Logger.info(`${MCP_ADMIN_ENDPOINT_LOG_PREFIX}${this.adminEndpointUrl()}`, loggerCtx);
        if (this.activation.enabled) {
            Logger.warn(
                'Local trust is on: a caller presenting the secret in ' +
                    `${this.activation.stateFile} acts as the superadmin on POST /mcp/admin and the ` +
                    'Admin API, from this machine only. The Vendure CLI started this server. Set ' +
                    'McpPlugin.init({ localTrust: false }) on any server that runs outside a ' +
                    "developer's machine.",
                loggerCtx,
            );
            await this.deleteLeftoverSessions();
        } else if (this.activation.refusedReason) {
            Logger.warn(
                `A local-trust secret was passed to this server, but local trust is off: ` +
                    `${this.activation.refusedReason}.`,
                loggerCtx,
            );
        }
    }

    /** @internal */
    async onApplicationShutdown(): Promise<void> {
        const session = this.adminApiSession;
        this.adminApiSession = undefined;
        if (!session) {
            return;
        }
        try {
            await this.deleteSession(await session);
        } catch (e) {
            Logger.warn(
                `Could not delete the local-trust Admin API session: ${e instanceof Error ? e.message : String(e)}`,
                loggerCtx,
            );
        }
    }

    /**
     * The admin MCP endpoint's URL for a client on this machine. It always names a loopback host,
     * since local trust refuses any other `Host`. A server listening on every address, or on a
     * LAN name, is reached through `localhost`.
     */
    adminEndpointUrl(): string {
        const { hostname, port } = this.configService.apiOptions;
        const host = !hostname || !isLoopbackHostname(hostname) ? 'localhost' : hostname;
        // An IPv6 address needs brackets in a URL.
        const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
        return `http://${urlHost}:${port}/mcp/admin`;
    }

    /** True when local trust is on in this process, which only the main server process can be. */
    isEnabled(): boolean {
        return this.activation.enabled && this.processContext.isServer;
    }

    /**
     * True only when local trust is on, the request came straight from a local client, and the
     * presented secret matches. Never throws.
     */
    verify(request: LocalTrustRequest, presented: string | undefined): boolean {
        if (!this.activation.enabled || !this.processContext.isServer || !presented) {
            return false;
        }
        if (!isLoopbackSocketAddress(request.socketAddress)) {
            return false;
        }
        if (FORWARDED_HEADERS.some(name => request.headers[name] !== undefined)) {
            return false;
        }
        if (!this.passesDnsRebindingCheck(request.headers)) {
            return false;
        }
        return timingSafeEqual(hashLocalTrustSecret(presented), this.activation.secretHash);
    }

    /** Reads the parts of an Express request that {@link verify} checks. */
    requestOf(req: Request): LocalTrustRequest {
        return { socketAddress: req.socket?.remoteAddress, headers: req.headers };
    }

    /**
     * Charges a presented bearer token that failed {@link verify} to the shared authentication
     * failure bucket. Only called where no other check charges it.
     */
    async recordFailedAttempt(clientIp: string | undefined): Promise<void> {
        await this.rateLimiter.recordBearerAuthFailure(clientIp);
    }

    /**
     * The superadmin context for a local-trust MCP call. It carries the superadmin's permissions
     * but no session row. The channel comes from the channel token, or is the default channel.
     */
    async createRequestContext(req: I18nRequest, channelToken: string | undefined): Promise<RequestContext> {
        const user = await this.getSuperadmin();
        const base = await this.requestContextService.create({
            apiType: 'admin',
            user,
            channelOrToken: channelToken,
        });
        return new RequestContext({
            req,
            apiType: 'admin',
            channel: base.channel,
            session: base.session,
            languageCode: getLanguageCodeFromQuery(req),
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
            translationFn: req.t,
        });
    }

    /**
     * Express middleware for the Admin API path. A request presenting a valid secret has its
     * `Authorization` header replaced with the token of the run's superadmin session, and then
     * passes through the normal Admin API auth guard. Any other request is left as it is, so a
     * wrong secret is an anonymous request.
     */
    adminApiMiddleware() {
        return (req: Request, _res: Response, next: NextFunction): void => {
            this.authenticateAdminApiRequest(req).then(
                () => next(),
                (e: unknown) => next(e),
            );
        };
    }

    private async authenticateAdminApiRequest(req: Request): Promise<void> {
        const presented = getBearerToken(req.headers.authorization);
        if (!presented) {
            return;
        }
        if (this.verify(this.requestOf(req), presented)) {
            req.headers.authorization = `Bearer ${await this.getAdminApiSessionToken()}`;
            return;
        }
        if (this.isEnabled() && SECRET_SHAPE.test(presented)) {
            await this.recordFailedAttempt(getClientIp(req));
        }
    }

    /**
     * The token of the one Admin API session this run uses. It is created on first use, and
     * created again when it has gone, for example after the session expired or was deleted.
     */
    private async getAdminApiSessionToken(): Promise<string> {
        const current = this.adminApiSession;
        if (current) {
            const token = await current.catch(() => undefined);
            if (token && (await this.sessionService.getSessionFromToken(token))) {
                return token;
            }
            // Only the request that saw the session go replaces it; the others wait for that one.
            if (this.adminApiSession !== current) {
                return this.getAdminApiSessionToken();
            }
        }
        const created = this.createAdminApiSession();
        this.adminApiSession = created;
        try {
            return await created;
        } catch (e) {
            if (this.adminApiSession === created) {
                this.adminApiSession = undefined;
            }
            throw e;
        }
    }

    private async createAdminApiSession(): Promise<string> {
        const user = await this.getSuperadmin();
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const session = await this.sessionService.createNewAuthenticatedSession(
            ctx,
            user,
            LOCAL_TRUST_SESSION_STRATEGY,
            undefined,
            'admin',
        );
        return session.token;
    }

    /**
     * A run that crashed never reached its shutdown hook, so its session row is still there, valid
     * for the full session duration. Each run makes its own, so any older one can go.
     */
    private async deleteLeftoverSessions(): Promise<void> {
        try {
            const ctx = await this.requestContextService.create({ apiType: 'admin' });
            const leftovers = await this.connection
                .getRepository(ctx, AuthenticatedSession)
                .find({ where: { authenticationStrategy: LOCAL_TRUST_SESSION_STRATEGY } });
            // The rows are independent, so they are deleted at once.
            await Promise.all(leftovers.map(leftover => this.deleteSession(leftover.token)));
        } catch (e) {
            Logger.warn(
                `Could not delete the local-trust sessions of earlier runs: ${e instanceof Error ? e.message : String(e)}`,
                loggerCtx,
            );
        }
    }

    private async deleteSession(token: string): Promise<void> {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        await this.connection.getRepository(ctx, Session).delete({ token });
        await deleteCachedVendureSession(this.configService, token);
    }

    private async getSuperadmin(): Promise<User> {
        if (this.superadmin) {
            return this.superadmin;
        }
        const { identifier } = this.configService.authOptions.superadminCredentials;
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        // Permissions are resolved from the user id each time a context is created, so they stay current.
        const user = await this.connection.getRepository(ctx, User).findOne({ where: { identifier } });
        if (!user || user.deletedAt) {
            throw new UnauthorizedException(
                `Local trust acts as the superadmin "${identifier}", which does not exist`,
            );
        }
        this.superadmin = user;
        return user;
    }

    /**
     * Stricter than the configurable DNS-rebinding guard, and independent of it: the `Host` must
     * name the local machine, and a request with an `Origin` is refused, since the CLI sends none
     * and a browser always does.
     */
    private passesDnsRebindingCheck(headers: LocalTrustRequest['headers']): boolean {
        if (headers.origin !== undefined) {
            return false;
        }
        const host = headers.host;
        if (typeof host !== 'string') {
            return false;
        }
        const hostname = hostnameOfHostHeader(host);
        return hostname !== undefined && isLoopbackHostname(hostname);
    }
}

/**
 * The hostname of a `Host` header value, without the port. An IPv6 address must be bracketed, as
 * in `[::1]:3000`, and is returned with its brackets. Undefined for a malformed value.
 */
export function hostnameOfHostHeader(host: string): string | undefined {
    const value = host.trim().toLowerCase();
    let hostname: string;
    let rest: string;
    if (value.startsWith('[')) {
        const end = value.indexOf(']');
        if (end === -1) {
            return undefined;
        }
        hostname = value.slice(0, end + 1);
        rest = value.slice(end + 1);
    } else {
        const colon = value.indexOf(':');
        hostname = colon === -1 ? value : value.slice(0, colon);
        rest = colon === -1 ? '' : value.slice(colon);
    }
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) {
        return undefined;
    }
    return hostname || undefined;
}
