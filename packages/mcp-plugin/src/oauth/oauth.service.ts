import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import {
    Administrator,
    AuthenticatedSession,
    ChannelService,
    ConfigService,
    EntityNotFoundError,
    ID,
    idsAreEqual,
    Logger,
    RequestContext,
    RequestContextService,
    Session,
    SessionService,
    TransactionalConnection,
    User,
    UserService,
} from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { IsNull, MoreThan } from 'typeorm';

import {
    loggerCtx,
    MAX_CLIENT_METADATA_FIELD_LENGTH,
    MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS,
    MCP_PLUGIN_OPTIONS,
    mcpServerPermission,
    OAUTH_ENDPOINT_PATHS,
    SUPPORTED_OAUTH_GRANT_TYPES,
} from '../constants';
import { McpAuthorizationCode } from '../entities/mcp-authorization-code.entity';
import { McpAuthorizationRequest } from '../entities/mcp-authorization-request.entity';
import { McpOauthClient } from '../entities/mcp-oauth-client.entity';
import { McpOauthGrant } from '../entities/mcp-oauth-grant.entity';
import { McpAuthenticatedContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpGrantUserType } from '../types';

import { McpCimdClientResolverService } from './cimd/cimd-client-resolver.service';
import { isUrlClientId } from './cimd/cimd-url';
import {
    AuthorizationRequestInfo,
    AuthorizeInput,
    OAuthTokenResponse,
    RegisterClientInput,
    RegisteredClientResponse,
    ResolvedMcpOauthOptions,
    TokenInput,
} from './oauth-types';
import {
    addSeconds,
    appendOAuthParams,
    assertSafeRedirectUri,
    deleteCachedVendureSession,
    httpsUrlOrNull,
    randomToken,
    verifyPkceChallenge,
} from './oauth-utils';
import { deriveHashKey, hashLookupToken } from './token-hash';

/**
 * Name recorded against the dedicated Vendure session created for an MCP grant.
 */
const MCP_SESSION_STRATEGY = 'mcp-dedicated-session';

/**
 * Implements the MCP OAuth 2.1 authorization server.
 *
 * Core Features:
 * - Handles CIMD (URL client_id) resolution and Dynamic Client Registration, authorize/consent
 *   flows, revocation, and `.well-known` metadata.
 * - Supports authorization-code and refresh-token grants.
 *
 * Session & Security Mechanics:
 * - Each grant owns one isolated Vendure session with a random generated token.
 * - OAuth access and refresh tokens rotate independently of that session.
 * - Bearer authentication validates the grant first, then resolves its session by
 *   {@link McpOauthGrant.vendureSessionId}; the session token is never returned to authenticated MCP clients.
 * - Revocation and expired-grant retention delete the session row and evict its cache entry.
 */
@Injectable()
export class McpOauthService {
    private cachedHashKey: Buffer | undefined;

    constructor(
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
        private sessionService: SessionService,
        private channelService: ChannelService,
        private userService: UserService,
        private configService: ConfigService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
        private cimdClientResolver: McpCimdClientResolverService,
    ) {}

    async registerClient(input: RegisterClientInput): Promise<RegisteredClientResponse> {
        if (!input.client_name) {
            throw new BadRequestException('client_name is required');
        }
        if (input.client_name.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
            throw new BadRequestException(
                `client_name must be at most ${MAX_CLIENT_METADATA_FIELD_LENGTH} characters`,
            );
        }
        if (!input.redirect_uris || input.redirect_uris.length === 0) {
            throw new BadRequestException('redirect_uris is required');
        }
        for (const redirectUri of input.redirect_uris) {
            assertSafeRedirectUri(redirectUri);
        }
        if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') {
            throw new BadRequestException(
                'token_endpoint_auth_method must be "none" — this server does not support client authentication',
            );
        }
        if (input.grant_types?.some(grantType => !SUPPORTED_OAUTH_GRANT_TYPES.includes(grantType))) {
            throw new BadRequestException(
                'grant_types may only contain "authorization_code" and "refresh_token" — the only grants this server supports',
            );
        }
        const ctx = await this.createAdminCtx();
        const client = await this.connection.getRepository(ctx, McpOauthClient).save(
            new McpOauthClient({
                clientId: randomToken(),
                clientName: input.client_name,
                clientUri: httpsUrlOrNull(input.client_uri),
                logoUri: httpsUrlOrNull(input.logo_uri),
                redirectUris: input.redirect_uris,
                grantTypes: input.grant_types ?? [...SUPPORTED_OAUTH_GRANT_TYPES],
                tokenEndpointAuthMethod: input.token_endpoint_auth_method ?? 'none',
                cimdDocumentExpiresAt: null,
                lastUsedAt: null,
            }),
        );

        return {
            client_id: client.clientId,
            client_name: client.clientName,
            ...(client.clientUri ? { client_uri: client.clientUri } : {}),
            ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
            redirect_uris: client.redirectUris,
            grant_types: client.grantTypes,
            token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        };
    }

    metadata() {
        const issuer = this.issuerOrigin();
        return {
            issuer,
            authorization_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.authorize}`,
            token_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.token}`,
            registration_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.register}`,
            revocation_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.revoke}`,
            response_types_supported: ['code'],
            grant_types_supported: SUPPORTED_OAUTH_GRANT_TYPES,
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            // CIMD (draft-ietf-oauth-client-id-metadata-document §6): clients gate on this
            // flag before sending a URL client_id. MUST be present because we support it.
            client_id_metadata_document_supported: true,
        };
    }

    protectedResourceMetadata(endpoint: string) {
        if (endpoint !== 'shop' && endpoint !== 'admin') {
            throw new NotFoundException();
        }
        if (endpoint === 'shop' && this.options.shopAccess === 'disabled') {
            throw new NotFoundException();
        }
        const issuer = this.issuerOrigin();
        return {
            resource: this.resourceForToolset(endpoint),
            authorization_servers: [issuer],
            bearer_methods_supported: ['header'],
            resource_name: `Vendure ${endpoint} MCP`,
        };
    }

    protectedResourceMetadataUrl(endpoint: McpToolset): string {
        return getOAuthProtectedResourceMetadataUrl(new URL(this.resourceForToolset(endpoint)));
    }

    async createAuthorizationRedirect(input: AuthorizeInput): Promise<string> {
        if (input.response_type !== 'code') {
            throw new BadRequestException('Only response_type=code is supported');
        }
        if (!input.client_id || !input.redirect_uri || !input.code_challenge) {
            throw new BadRequestException('client_id, redirect_uri and code_challenge are required');
        }
        if (input.code_challenge_method !== 'S256') {
            throw new BadRequestException('Only PKCE S256 is supported');
        }
        // Everything that can be judged from the request alone is checked first, because
        // resolving the client may fetch a metadata document from the address the caller named,
        // and this endpoint takes no credentials. `resolvedOauth` refuses a server with no OAuth
        // configured, and `resolveResource` a request that names no toolset of ours.
        this.resolvedOauth();
        const { resource, toolset } = this.resolveResource(input.resource);
        const ctx = await this.createAdminCtx();
        const client = await this.findClient(ctx, input.client_id);
        if (!client.redirectUris.includes(input.redirect_uri)) {
            throw new BadRequestException('redirect_uri is not registered for client');
        }
        // From here the redirect_uri is a verified target, so remaining request errors are
        // reported by redirecting there rather than by an HTTP error response.
        const redirectUri = input.redirect_uri;
        const invalidRequest = (error_description: string) =>
            appendOAuthParams(redirectUri, {
                error: 'invalid_request',
                error_description,
                state: input.state,
            });
        if (input.state && input.state.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
            return invalidRequest(`state must not exceed ${MAX_CLIENT_METADATA_FIELD_LENGTH} characters`);
        }
        // RFC 7636 §4.2: a code_challenge is 43-128 characters.
        if (input.code_challenge.length < 43 || input.code_challenge.length > 128) {
            return invalidRequest('code_challenge must be between 43 and 128 characters (RFC 7636)');
        }

        let consentUrl: URL;
        if (toolset === 'admin') {
            consentUrl = new URL(this.resolvedOauth().adminConsentPath, this.resolvedOauth().issuer);
        } else {
            const storefrontConsentUrl = this.resolvedOauth().storefrontConsentUrl;
            if (!storefrontConsentUrl) {
                Logger.error(
                    'A customer authorization request was refused because oauth.storefrontConsentUrl is not set. ' +
                        'Set it to your storefront consent page URL. Staff-only deployments do not need it.',
                    loggerCtx,
                );
                return appendOAuthParams(redirectUri, {
                    error: 'server_error',
                    error_description: 'This store is not configured to authorize customer access.',
                    state: input.state,
                });
            }
            consentUrl = new URL(storefrontConsentUrl);
        }

        const requestTokenPlaintext = randomToken();
        await this.connection.getRepository(ctx, McpAuthorizationRequest).save(
            new McpAuthorizationRequest({
                requestToken: this.hashLookup(requestTokenPlaintext),
                oauthClient: client,
                oauthClientId: client.id,
                redirectUri,
                state: input.state ?? null,
                codeChallenge: input.code_challenge,
                codeChallengeMethod: 'S256',
                toolset,
                resource,
                expiresAt: addSeconds(new Date(), this.resolvedOauth().authorizationRequestTtlSeconds),
            }),
        );
        consentUrl.searchParams.set('request_token', requestTokenPlaintext);
        return consentUrl.toString();
    }

    async getAuthorizationRequestInfo(requestToken: string | undefined): Promise<AuthorizationRequestInfo> {
        if (!requestToken) {
            throw new BadRequestException('request_token is required');
        }
        const request = await this.findActiveAuthorizationRequest(requestToken);
        const client = request.oauthClient;
        return {
            client_id: client.clientId,
            // A URL client_id is one this server fetched a metadata document from; anything else
            // is a token it issued at registration.
            client_id_source: isUrlClientId(client.clientId) ? 'cimd' : 'dcr',
            client_name: client.clientName,
            ...(client.clientUri ? { client_uri: client.clientUri } : {}),
            ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
            redirect_uri: request.redirectUri,
            resource: request.resource,
            toolset: request.toolset,
        };
    }

    async approveAdminRequest(
        ctx: RequestContext,
        requestToken: string,
        approved: boolean,
    ): Promise<{ redirectUrl: string }> {
        if (!ctx.activeUserId || !ctx.session?.token) {
            throw new UnauthorizedException('Admin consent requires an authenticated administrator session');
        }

        if (!ctx.userHasPermissions([mcpServerPermission.Update])) {
            throw new ForbiddenException(
                'Admin consent requires an administrator with the UpdateMcpServer permission',
            );
        }
        this.assertConsentRequestOrigin(ctx);
        if (!approved) {
            return this.denyAuthorizationRequest(requestToken, 'admin');
        }
        return this.approveAuthorizationRequest(requestToken, 'admin', {
            actorId: ctx.activeUserId,
            actorType: 'admin',
        });
    }

    /**
     * Records a customer's decision on a pending authorization request. Called from the Shop
     * API, so `ctx` already identifies the customer and the channel.
     */
    async approveCustomerRequest(
        ctx: RequestContext,
        requestToken: string,
        approved: boolean,
    ): Promise<{ redirectUrl: string }> {
        if (!approved) {
            return this.denyAuthorizationRequest(requestToken, 'shop');
        }
        if (!ctx.activeUserId) {
            throw new UnauthorizedException('Approving requires a signed-in customer');
        }
        this.assertStorefrontConsentOrigin(ctx);
        await this.assertNotAnAdministrator(ctx);
        return this.approveAuthorizationRequest(requestToken, 'shop', {
            actorId: ctx.activeUserId,
            actorType: 'customer',
            channelId: ctx.channelId ?? null,
        });
    }

    private async assertNotAnAdministrator(ctx: RequestContext): Promise<void> {
        const administrator = await this.connection
            .getRepository(ctx, Administrator)
            .findOne({ where: { user: { id: ctx.activeUserId } }, relations: ['user'] });
        if (administrator) {
            throw new ForbiddenException('Customer consent cannot be given by an administrator');
        }
    }

    async exchangeToken(input: TokenInput) {
        if (input.grant_type === 'authorization_code') {
            return this.exchangeAuthorizationCode(input);
        }
        if (input.grant_type === 'refresh_token') {
            return this.exchangeRefreshToken(input);
        }
        throw new BadRequestException('Unsupported grant_type');
    }

    async revoke(token: string | undefined): Promise<Record<string, never>> {
        if (!token) {
            return {};
        }
        const ctx = await this.createAdminCtx();
        const hash = this.hashLookup(token);
        // Either token of the pair identifies the grant, and revoking one kills the
        // whole grant (RFC 7009: revoking a refresh token invalidates its access token).
        const grant = await this.connection.getRepository(ctx, McpOauthGrant).findOne({
            where: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
        });
        if (grant && !grant.revokedAt) {
            await this.revokeGrant(ctx, grant);
        }
        return {};
    }

    async revokeGrantById(ctx: RequestContext, grantId: ID): Promise<boolean> {
        const grant = await this.connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { id: grantId } });
        if (!grant) {
            return false;
        }
        if (
            ctx.channelId != null &&
            grant.channelId != null &&
            !idsAreEqual(grant.channelId, ctx.channelId)
        ) {
            return false;
        }
        if (!grant.revokedAt) {
            await this.revokeGrant(ctx, grant);
        }
        return true;
    }

    /**
     * The signed-in customer's own active grants (not revoked, not expired). No channel filter:
     * the consent belongs to the person, not the storefront it happened to be made on, so a
     * customer sees every grant regardless of which sales channel it came from.
     */
    async listCustomerGrants(ctx: RequestContext): Promise<McpOauthGrant[]> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedException('Listing MCP client grants requires a signed-in customer');
        }
        return this.connection.getRepository(ctx, McpOauthGrant).find({
            where: {
                actorId: ctx.activeUserId,
                actorType: 'customer',
                revokedAt: IsNull(),
                expiresAt: MoreThan(new Date()),
            },
            relations: ['oauthClient'],
            order: { lastActivityAt: 'DESC' },
        });
    }

    /**
     * Revokes a grant on behalf of the signed-in customer. An id that doesn't exist and an id
     * that belongs to someone else are refused with the same EntityNotFoundError, so a caller
     * can't use the response to tell which of those it is.
     */
    async revokeCustomerGrant(ctx: RequestContext, grantId: ID): Promise<boolean> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedException('Revoking an MCP client grant requires a signed-in customer');
        }
        const grant = await this.connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { id: grantId } });
        if (!grant || grant.actorType !== 'customer' || !idsAreEqual(grant.actorId, ctx.activeUserId)) {
            throw new EntityNotFoundError('McpOauthGrant', grantId);
        }
        if (!grant.revokedAt) {
            await this.revokeGrant(ctx, grant);
        }
        return true;
    }

    private async revokeGrant(ctx: RequestContext, grant: McpOauthGrant): Promise<void> {
        const sessionToken = await this.connection.withTransaction(ctx, async txCtx => {
            await this.connection
                .getRepository(txCtx, McpOauthGrant)
                .update({ id: grant.id }, { revokedAt: new Date() });
            return this.deleteVendureSessionRow(txCtx, grant.vendureSessionId);
        });
        await deleteCachedVendureSession(this.configService, sessionToken);
    }

    async authenticateBearerToken(token: string, apiType: McpToolset): Promise<McpAuthenticatedContext> {
        const adminCtx = await this.createAdminCtx();
        const resolved = await this.findGrantAndSessionToken(adminCtx, token);
        const grant = resolved?.grant;
        if (!grant || grant.revokedAt || grant.accessTokenExpiresAt <= new Date()) {
            throw new UnauthorizedException('Invalid or expired access token');
        }
        if (
            (apiType === 'admin' && grant.actorType !== 'admin') ||
            (apiType === 'shop' && grant.actorType !== 'customer')
        ) {
            throw new UnauthorizedException('Access token does not allow this MCP endpoint');
        }
        if (grant.resource !== this.resourceForToolset(apiType)) {
            throw new UnauthorizedException('Access token was not issued for this MCP resource');
        }
        if (grant.expiresAt <= new Date()) {
            throw new UnauthorizedException('MCP grant is expired');
        }

        let vendureSession = resolved.sessionToken
            ? await this.sessionService.getSessionFromToken(resolved.sessionToken)
            : undefined;
        if (!vendureSession) {
            const user = await this.userService.getUserById(adminCtx, grant.actorId);
            if (!user || user.deletedAt) {
                await this.revokeGrant(adminCtx, grant);
                throw new UnauthorizedException('Vendure user no longer exists');
            }
            // The lapsed session row may still be in the table — Vendure clears expired
            // sessions with a background job, not on read — so remove it, and its cache
            // entry, before creating the replacement the grant will point at.
            const staleSessionToken = await this.deleteVendureSessionRow(adminCtx, grant.vendureSessionId);
            await deleteCachedVendureSession(this.configService, staleSessionToken);
            const createdSession = await this.createVendureSession(adminCtx, user);
            grant.vendureSessionId = createdSession.id;
            await this.connection
                .getRepository(adminCtx, McpOauthGrant)
                .update({ id: grant.id }, { vendureSessionId: createdSession.id });
            vendureSession = await this.sessionService.getSessionFromToken(createdSession.token);
            if (!vendureSession) {
                throw new UnauthorizedException('Failed to establish Vendure session');
            }
        }

        const channel = grant.channelId
            ? await this.channelService.findOne(adminCtx, grant.channelId)
            : await this.channelService.getDefaultChannel(adminCtx);
        if (!channel) {
            await this.revokeGrant(adminCtx, grant);
            throw new UnauthorizedException('Channel no longer exists');
        }
        const ctx = new RequestContext({
            apiType,
            channel,
            session: vendureSession,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
        // Bump the audit timestamp at most once per interval, in the background, as a
        // single-column update — the request must not wait for it. Mirrors core's
        // handling of ApiKey.lastUsedAt in auth-guard.ts.
        const staleBefore = new Date(Date.now() - MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS);
        if (!grant.lastActivityAt || grant.lastActivityAt < staleBefore) {
            this.connection
                .getRepository(adminCtx, McpOauthGrant)
                .update({ id: grant.id }, { lastActivityAt: new Date() })
                .catch(err =>
                    Logger.error(
                        `Failed to update lastActivityAt for MCP grant ${String(grant.id)}`,
                        loggerCtx,
                        err?.stack,
                    ),
                );
        }
        return { ctx, grant };
    }

    /**
     * Loads the grant for an access token together with its session's token in one query.
     * The session token is raw-selected through a LEFT JOIN rather than a mapped relation:
     * `Session.token` must never be duplicated onto the grant entity, and a missing session
     * (cleaned up or lapsed) must not hide a live grant from the re-creation path above.
     */
    private async findGrantAndSessionToken(
        ctx: RequestContext,
        accessToken: string,
    ): Promise<{ grant: McpOauthGrant; sessionToken: string | null } | undefined> {
        const result = await this.connection
            .getRepository(ctx, McpOauthGrant)
            .createQueryBuilder('grant')
            .leftJoinAndSelect('grant.oauthClient', 'oauthClient')
            .leftJoin(Session, 'vendureSession', 'vendureSession.id = grant.vendureSessionId')
            .addSelect('vendureSession.token', 'vendureSessionToken')
            .where('grant.accessTokenHash = :accessTokenHash', {
                accessTokenHash: this.hashLookup(accessToken),
            })
            .getRawAndEntities<{ vendureSessionToken: string | null }>();
        const grant = result.entities[0];
        return grant ? { grant, sessionToken: result.raw[0]?.vendureSessionToken ?? null } : undefined;
    }

    /**
     * Loads a pending authorization request and consumes it, atomically and single-use.
     *
     * The toolset comparison is the entitlement check: the authorize endpoint needs no
     * credential, so anyone can start a request for either toolset and read the request token
     * out of the redirect. Each caller therefore states which toolset it is entitled to decide
     * (admin consent → admin requests, customer consent → shop requests), rather than trusting
     * the token alone.
     */
    private async consumeAuthorizationRequest(
        requestToken: string,
        expectedToolset: McpToolset,
    ): Promise<{ ctx: RequestContext; request: McpAuthorizationRequest }> {
        const ctx = await this.createAdminCtx();
        const request = await this.findActiveAuthorizationRequest(requestToken, ctx);
        if (request.toolset !== expectedToolset) {
            throw new BadRequestException('Authorization request invalid or expired');
        }
        const claim = await this.connection
            .getRepository(ctx, McpAuthorizationRequest)
            .createQueryBuilder()
            .delete()
            .where('requestToken = :requestToken', { requestToken: this.hashLookup(requestToken) })
            .execute();
        if (!claim.affected) {
            throw new BadRequestException('Authorization request invalid or expired');
        }
        return { ctx, request };
    }

    /** Consumes the request and sends the browser back with `error=access_denied`. */
    private async denyAuthorizationRequest(
        requestToken: string,
        expectedToolset: McpToolset,
    ): Promise<{ redirectUrl: string }> {
        const { request } = await this.consumeAuthorizationRequest(requestToken, expectedToolset);
        return {
            redirectUrl: appendOAuthParams(request.redirectUri, {
                error: 'access_denied',
                state: request.state ?? undefined,
            }),
        };
    }

    /** Consumes the request, issues an authorization code for `approver`, and sends the browser back with it. */
    private async approveAuthorizationRequest(
        requestToken: string,
        expectedToolset: McpToolset,
        approver: { actorId: ID; actorType: McpGrantUserType; channelId?: ID | null },
    ): Promise<{ redirectUrl: string }> {
        const { ctx, request } = await this.consumeAuthorizationRequest(requestToken, expectedToolset);
        const { actorId, actorType, channelId = null } = approver;
        const codePlaintext = randomToken();
        await this.connection.getRepository(ctx, McpAuthorizationCode).save(
            new McpAuthorizationCode({
                code: this.hashLookup(codePlaintext),
                oauthClient: request.oauthClient,
                oauthClientId: request.oauthClientId,
                actorId,
                actorType,
                redirectUri: request.redirectUri,
                resource: request.resource,
                codeChallenge: request.codeChallenge,
                codeChallengeMethod: request.codeChallengeMethod,
                channelId,
                expiresAt: addSeconds(new Date(), this.resolvedOauth().authorizationCodeTtlSeconds),
            }),
        );
        return {
            redirectUrl: appendOAuthParams(request.redirectUri, {
                code: codePlaintext,
                state: request.state ?? undefined,
            }),
        };
    }

    private async exchangeAuthorizationCode(input: TokenInput) {
        if (
            !input.code ||
            !input.client_id ||
            !input.redirect_uri ||
            !input.code_verifier ||
            !input.resource
        ) {
            throw new BadRequestException(
                'code, client_id, redirect_uri, code_verifier and resource are required',
            );
        }
        const { resource } = this.resolveResource(input.resource);
        const ctx = await this.createAdminCtx();
        const codeRepo = this.connection.getRepository(ctx, McpAuthorizationCode);
        const codeHash = this.hashLookup(input.code);
        const code = await codeRepo.findOne({
            where: { code: codeHash },
            relations: ['oauthClient'],
        });
        if (!code || code.expiresAt <= new Date()) {
            throw new BadRequestException('Authorization code invalid or expired');
        }
        if (code.oauthClient.clientId !== input.client_id || code.redirectUri !== input.redirect_uri) {
            throw new BadRequestException('Authorization code does not match client or redirect_uri');
        }
        if (code.resource !== resource) {
            throw new BadRequestException('Authorization code does not match token request resource');
        }
        if (!verifyPkceChallenge(input.code_verifier, code.codeChallenge)) {
            throw new BadRequestException('Invalid PKCE verifier');
        }
        const claim = await codeRepo
            .createQueryBuilder()
            .delete()
            .where('code = :code', { code: codeHash })
            .execute();
        if (!claim.affected) {
            throw new BadRequestException('Authorization code invalid or expired');
        }
        return this.issueTokenPair(
            ctx,
            code.oauthClient,
            code.actorId,
            code.actorType,
            code.resource,
            code.channelId,
        );
    }

    private async exchangeRefreshToken(input: TokenInput) {
        if (!input.refresh_token || !input.client_id || !input.resource) {
            throw new BadRequestException('refresh_token, client_id and resource are required');
        }
        const { resource } = this.resolveResource(input.resource);
        const ctx = await this.createAdminCtx();
        const grantRepo = this.connection.getRepository(ctx, McpOauthGrant);
        const refreshTokenHash = this.hashLookup(input.refresh_token);
        const grant = await grantRepo.findOne({
            where: { refreshTokenHash },
            relations: ['oauthClient'],
        });
        if (!grant) {
            const reused = await grantRepo.findOne({
                where: { previousRefreshTokenHash: refreshTokenHash },
            });
            if (reused && !reused.revokedAt) {
                await this.revokeGrant(ctx, reused);
            }
            throw new BadRequestException('Refresh token invalid or expired');
        }
        if (grant.revokedAt || grant.expiresAt <= new Date()) {
            throw new BadRequestException('Refresh token invalid or expired');
        }
        if (grant.oauthClient.clientId !== input.client_id) {
            throw new BadRequestException('Refresh token does not match client');
        }
        if (grant.resource !== resource) {
            throw new BadRequestException('Refresh token does not match token request resource');
        }

        const now = new Date();
        const accessPlaintext = randomToken();
        const refreshPlaintext = randomToken();
        await this.connection.withTransaction(ctx, async txCtx => {
            // Atomically claim the rotation by swapping the token hashes in place. If two
            // requests race with the same refresh token, only one UPDATE matches; the loser
            // sees affected=0 and is rejected. The old refresh hash is kept so a later
            // replay of it is recognized as reuse (above) rather than an unknown token.
            const claim = await this.connection
                .getRepository(txCtx, McpOauthGrant)
                .createQueryBuilder()
                .update(McpOauthGrant)
                .set({
                    accessTokenHash: this.hashLookup(accessPlaintext),
                    refreshTokenHash: this.hashLookup(refreshPlaintext),
                    previousRefreshTokenHash: refreshTokenHash,
                    accessTokenExpiresAt: addSeconds(now, this.resolvedOauth().accessTokenTtlSeconds),
                    expiresAt: addSeconds(now, this.resolvedOauth().refreshTokenTtlSeconds),
                    lastActivityAt: now,
                })
                .where('id = :id', { id: grant.id })
                .andWhere('refreshTokenHash = :refreshTokenHash', { refreshTokenHash })
                .andWhere('revokedAt IS NULL')
                .execute();
            if (!claim.affected) {
                throw new BadRequestException('Refresh token invalid or expired');
            }
            await this.connection
                .getRepository(txCtx, McpOauthClient)
                .update({ id: grant.oauthClientId }, { lastUsedAt: now });
        });
        return this.tokenResponse(accessPlaintext, refreshPlaintext);
    }

    private async issueTokenPair(
        ctx: RequestContext,
        client: McpOauthClient,
        actorId: ID,
        actorType: McpGrantUserType,
        resource: string,
        channelId: ID | null = null,
    ): Promise<OAuthTokenResponse> {
        const user = await this.userService.getUserById(ctx, actorId);
        if (!user) {
            throw new BadRequestException('Vendure user no longer exists');
        }
        const now = new Date();
        const accessPlaintext = randomToken();
        const refreshPlaintext = randomToken();
        const createdSession = await this.createVendureSession(ctx, user);
        await this.connection.getRepository(ctx, McpOauthGrant).save(
            new McpOauthGrant({
                accessTokenHash: this.hashLookup(accessPlaintext),
                refreshTokenHash: this.hashLookup(refreshPlaintext),
                previousRefreshTokenHash: null,
                oauthClient: client,
                oauthClientId: client.id,
                actorId,
                actorType,
                resource,
                accessTokenExpiresAt: addSeconds(now, this.resolvedOauth().accessTokenTtlSeconds),
                expiresAt: addSeconds(now, this.resolvedOauth().refreshTokenTtlSeconds),
                revokedAt: null,
                vendureSessionId: createdSession.id,
                channelId,
                lastActivityAt: now,
            }),
        );

        await this.connection
            .getRepository(ctx, McpOauthClient)
            .update({ id: client.id }, { lastUsedAt: now });
        return this.tokenResponse(accessPlaintext, refreshPlaintext);
    }

    private tokenResponse(accessPlaintext: string, refreshPlaintext: string): OAuthTokenResponse {
        return {
            access_token: accessPlaintext,
            refresh_token: refreshPlaintext,
            token_type: 'Bearer',
            expires_in: this.resolvedOauth().accessTokenTtlSeconds,
        };
    }

    /**
     * Creates the dedicated Vendure session for a grant. No token is supplied, so Core
     * generates an ordinary random one — nothing about the session is derivable from
     * the OAuth tokens that reach it.
     */
    private createVendureSession(ctx: RequestContext, user: User): Promise<AuthenticatedSession> {
        return this.sessionService.createNewAuthenticatedSession(ctx, user, MCP_SESSION_STRATEGY);
    }

    /**
     * Removes a Vendure session row by id, if it still exists, and returns the token it
     * held so the caller can evict the cache entry. Deleting the row alone is not enough:
     * a cached session is served without touching the database until its entry ages out.
     */
    private async deleteVendureSessionRow(ctx: RequestContext, sessionId: ID): Promise<string | undefined> {
        const session = await this.connection
            .getRepository(ctx, Session)
            .findOne({ where: { id: sessionId } });
        if (!session) {
            return;
        }
        await this.connection.getRepository(ctx, Session).remove(session);
        return session.token;
    }

    private async findClient(ctx: RequestContext, clientId: string): Promise<McpOauthClient> {
        if (isUrlClientId(clientId)) {
            return this.cimdClientResolver.resolveClient(ctx, clientId);
        }
        const client = await this.connection.getRepository(ctx, McpOauthClient).findOne({
            where: { clientId },
        });
        if (!client) {
            throw new BadRequestException('Unknown OAuth client');
        }
        return client;
    }

    private async findActiveAuthorizationRequest(
        requestToken: string,
        ctx?: RequestContext,
    ): Promise<McpAuthorizationRequest> {
        const requestCtx = ctx ?? (await this.createAdminCtx());
        const request = await this.connection.getRepository(requestCtx, McpAuthorizationRequest).findOne({
            where: { requestToken: this.hashLookup(requestToken) },
            relations: ['oauthClient'],
        });
        if (!request || request.expiresAt <= new Date()) {
            throw new BadRequestException('Authorization request invalid or expired');
        }
        return request;
    }

    private createAdminCtx(): Promise<RequestContext> {
        return this.requestContextService.create({ apiType: 'admin' });
    }

    private resolveResource(resource?: string): { resource: string; toolset: McpToolset } {
        if (!resource) {
            throw new BadRequestException('resource is required');
        }
        let url: URL;
        try {
            url = new URL(resource);
        } catch {
            throw new BadRequestException('Unsupported OAuth resource');
        }
        if (url.search || url.hash) {
            throw new BadRequestException('OAuth resource must not include query parameters or fragments');
        }
        const toolsets: readonly McpToolset[] =
            this.options.shopAccess === 'disabled' ? (['admin'] as const) : (['shop', 'admin'] as const);
        for (const toolset of toolsets) {
            if (this.sameResourceUrl(url, new URL(this.resourceForToolset(toolset)))) {
                return { resource: this.resourceForToolset(toolset), toolset };
            }
        }
        throw new BadRequestException('Unsupported OAuth resource');
    }

    private sameResourceUrl(left: URL, right: URL): boolean {
        return (
            left.protocol.toLowerCase() === right.protocol.toLowerCase() &&
            left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
            left.port === right.port &&
            this.normalizeResourcePath(left.pathname) === this.normalizeResourcePath(right.pathname)
        );
    }

    private normalizeResourcePath(pathname: string): string {
        return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    }

    /** The configured issuer URL with any trailing slash removed. */
    private issuerOrigin(): string {
        return this.resolvedOauth().issuer.replace(/\/$/, '');
    }

    private resourceForToolset(toolset: McpToolset): string {
        return `${this.issuerOrigin()}/mcp/${toolset}`;
    }

    /**
     * CSRF guard for admin consent. Expects the Vendure server's own origin, because Vendure
     * serves the admin consent page itself. See {@link assertOriginMatches} for how the guard
     * works.
     */
    private assertConsentRequestOrigin(ctx: RequestContext): void {
        this.assertOriginMatches(
            ctx,
            new URL(this.resolvedOauth().issuer).origin,
            'Admin consent must be submitted from the Vendure consent page',
        );
    }

    /**
     * CSRF guard for customer consent. Expects the origin of the configured storefront consent
     * page, which lives on the merchant's own domain. A consent page rendered on a server calls
     * from Node with no `Origin` header, which is allowed — see {@link assertOriginMatches}.
     */
    private assertStorefrontConsentOrigin(ctx: RequestContext): void {
        const consentUrl = this.resolvedOauth().storefrontConsentUrl;
        if (!consentUrl) {
            throw new ForbiddenException(
                'Customer consent requires oauth.storefrontConsentUrl to be configured',
            );
        }
        this.assertOriginMatches(
            ctx,
            new URL(consentUrl).origin,
            'Customer consent must be submitted from your consent page',
        );
    }

    /**
     * CSRF protection for the consent endpoints:
     * If a request has an `Origin`, it must match ours.
     *
     * This prevents other websites from making requests using a signed-in user's session.
     * Browsers always send `Origin` for cross-site requests, so we can detect and block them.
     *
     * Requests without `Origin` (e.g. server or API calls) are allowed.
     * An `Authorization` header does not skip this check.
     */
    private assertOriginMatches(ctx: RequestContext, expectedOrigin: string, message: string): void {
        const rawOrigin = ctx.req?.headers?.origin;
        const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
        if (!originHeader) {
            return;
        }
        if (originHeader !== expectedOrigin) {
            throw new ForbiddenException(message);
        }
    }

    /**
     * Returns the resolved OAuth options, throwing if OAuth was not configured
     * (i.e. no `oauth.tokenSecret` was supplied to the plugin).
     */
    private resolvedOauth(): ResolvedMcpOauthOptions {
        if (!this.options.oauth?.tokenSecret) {
            throw new BadRequestException('MCP OAuth is not configured (oauth.tokenSecret is required)');
        }
        return this.options.oauth as ResolvedMcpOauthOptions;
    }

    /**
     * Derives (once) and returns the HMAC key used to hash the OAuth credentials —
     * access tokens, refresh tokens, authorization codes and request tokens — stored
     * in the token/code/request columns.
     */
    private getHashKey(): Buffer {
        if (!this.cachedHashKey) {
            this.cachedHashKey = deriveHashKey(this.resolvedOauth().tokenSecret);
        }
        return this.cachedHashKey;
    }

    private hashLookup(value: string): string {
        return hashLookupToken(value, this.getHashKey());
    }
}
