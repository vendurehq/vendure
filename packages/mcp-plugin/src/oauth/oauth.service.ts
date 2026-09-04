import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import {
    Administrator,
    ChannelService,
    EntityNotFoundError,
    I18nRequest,
    ID,
    idsAreEqual,
    Logger,
    RequestContext,
    RequestContextService,
    Session,
    SessionService,
    TransactionalConnection,
    UserService,
} from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { IsNull, MoreThan } from 'typeorm';

import {
    loggerCtx,
    MAX_CLIENT_METADATA_FIELD_LENGTH,
    MAX_OAUTH_STATE_LENGTH,
    MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS,
    MCP_PLUGIN_OPTIONS,
    mcpServerPermission,
    SUPPORTED_OAUTH_GRANT_TYPES,
} from '../constants';
import { McpAuthorizationCode } from '../entities/mcp-authorization-code.entity';
import { McpAuthorizationRequest } from '../entities/mcp-authorization-request.entity';
import { McpOauthClient } from '../entities/mcp-oauth-client.entity';
import { McpOauthGrant } from '../entities/mcp-oauth-grant.entity';
import { getLanguageCodeFromQuery } from '../get-language-code';
import { McpAuthenticatedContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpGrantUserType } from '../types';

import { McpCimdClientResolverService } from './cimd/cimd-client-resolver.service';
import { isUrlClientId } from './cimd/cimd-url';
import { McpGrantSessionService } from './grant-session.service';
import { McpAccessTokenExpiredError, McpOauthError } from './oauth-error';
import { McpOauthMetadataService } from './oauth-metadata.service';
import {
    AuthorizationRequestInfo,
    AuthorizeInput,
    OAuthTokenResponse,
    RegisterClientInput,
    RegisteredClientResponse,
    TokenInput,
} from './oauth-types';
import {
    addSeconds,
    appendOAuthParams,
    assertSafeRedirectUri,
    httpsUrlOrNull,
    McpOauthOptionsWithIssuer,
    randomToken,
    resolvedOauthOptions,
    verifyPkceChallenge,
} from './oauth-utils';
import { deriveHashKey, hashLookupToken } from './token-hash';

/** What findGrantAndSessionToken returns for a live access token: the grant and its Vendure session token, if any. */
interface GrantLookup {
    grant: McpOauthGrant;
    sessionToken: string | null;
}

/** Each MCP grant is backed by its own Vendure session, kept isolated so the underlying session token is never exposed to a client. */
@Injectable()
export class McpOauthService {
    private cachedHashKey: Buffer | undefined;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly requestContextService: RequestContextService,
        private readonly sessionService: SessionService,
        private readonly channelService: ChannelService,
        private readonly userService: UserService,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
        private readonly cimdClientResolver: McpCimdClientResolverService,
        private readonly grantSessions: McpGrantSessionService,
        private readonly oauthMetadata: McpOauthMetadataService,
    ) {}

    async registerClient(input: RegisterClientInput): Promise<RegisteredClientResponse> {
        this.resolvedOauth(); // Refuses before any write when OAuth is not configured.
        if (!input.client_name) {
            throw new McpOauthError('invalid_client_metadata', 'client_name is required');
        }
        if (input.client_name.length > MAX_CLIENT_METADATA_FIELD_LENGTH) {
            throw new McpOauthError(
                'invalid_client_metadata',
                `client_name must be at most ${MAX_CLIENT_METADATA_FIELD_LENGTH} characters`,
            );
        }
        if (!input.redirect_uris || input.redirect_uris.length === 0) {
            throw new McpOauthError('invalid_redirect_uri', 'redirect_uris is required');
        }
        for (const redirectUri of input.redirect_uris) {
            assertSafeRedirectUri(redirectUri);
        }
        if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') {
            throw new McpOauthError(
                'invalid_client_metadata',
                'token_endpoint_auth_method must be "none" — this server does not support client authentication',
            );
        }
        if (input.grant_types?.some(grantType => !SUPPORTED_OAUTH_GRANT_TYPES.includes(grantType))) {
            throw new McpOauthError(
                'invalid_client_metadata',
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

    async createAuthorizationRedirect(input: AuthorizeInput): Promise<string> {
        const oauth = this.resolvedOauth();
        if (!input.client_id || !input.redirect_uri) {
            throw new BadRequestException('client_id and redirect_uri are required');
        }
        const ctx = await this.createAdminCtx();
        const client = await this.findClient(ctx, input.client_id);
        if (!client.redirectUris.includes(input.redirect_uri)) {
            throw new BadRequestException('redirect_uri is not registered for client');
        }
        // Errors from here on are reported by redirecting to redirect_uri, since an HTTP error
        // response would only reach the browser, not the client waiting on the redirect.
        const redirectUri = input.redirect_uri;
        const redirectError = (error: string, error_description: string) =>
            appendOAuthParams(redirectUri, {
                error,
                error_description,
                state: input.state,
            });
        if (input.response_type !== 'code') {
            return redirectError('unsupported_response_type', 'Only response_type=code is supported');
        }
        if (!input.code_challenge) {
            return redirectError('invalid_request', 'code_challenge is required');
        }
        if (input.code_challenge_method !== 'S256') {
            return redirectError('invalid_request', 'Only PKCE S256 is supported');
        }
        let resource: string;
        let toolset: McpToolset;
        try {
            ({ resource, toolset } = this.oauthMetadata.resolveResource(input.resource));
        } catch (e) {
            if (e instanceof McpOauthError) {
                return redirectError(e.code, e.message);
            }
            throw e;
        }
        if (input.state && input.state.length > MAX_OAUTH_STATE_LENGTH) {
            return redirectError(
                'invalid_request',
                `state must not exceed ${MAX_OAUTH_STATE_LENGTH} characters`,
            );
        }
        // RFC 7636 §4.2: a code_challenge is 43-128 characters.
        if (input.code_challenge.length < 43 || input.code_challenge.length > 128) {
            return redirectError(
                'invalid_request',
                'code_challenge must be between 43 and 128 characters (RFC 7636)',
            );
        }

        let consentUrl: URL;
        if (toolset === 'admin') {
            consentUrl = new URL(oauth.adminConsentPath, oauth.issuer);
        } else {
            const storefrontConsentUrl = oauth.storefrontConsentUrl;
            if (!storefrontConsentUrl) {
                Logger.error(
                    'A customer authorization request was refused because oauth.storefrontConsentUrl is not set. ' +
                        'Set it to your storefront consent page URL. Staff-only deployments do not need it.',
                    loggerCtx,
                );
                return redirectError(
                    'server_error',
                    'This store is not configured to authorize customer access.',
                );
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
                expiresAt: addSeconds(new Date(), oauth.authorizationRequestTtlSeconds),
            }),
        );
        consentUrl.searchParams.set('request_token', requestTokenPlaintext);
        return consentUrl.toString();
    }

    async getAuthorizationRequestInfo(requestToken: string | undefined): Promise<AuthorizationRequestInfo> {
        if (!requestToken) {
            throw new BadRequestException('request_token is required');
        }
        const ctx = await this.createAdminCtx();
        const request = await this.findActiveAuthorizationRequest(requestToken, ctx);
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
            channelId: ctx.channelId ?? null,
        });
    }

    /** Called from the Shop API, so `ctx` already identifies the customer and channel. */
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
        throw new McpOauthError('unsupported_grant_type', 'Unsupported grant_type');
    }

    async revoke(token: string | undefined): Promise<Record<string, never>> {
        if (!token) {
            return {};
        }
        const ctx = await this.createAdminCtx();
        const hash = this.hashLookup(token);
        // Revoking either token in the pair kills the whole grant (RFC 7009), and the previous
        // refresh token counts too, since a client that lost its rotation response may still hold it.
        const grant = await this.connection.getRepository(ctx, McpOauthGrant).findOne({
            where: [
                { accessTokenHash: hash },
                { refreshTokenHash: hash },
                { previousRefreshTokenHash: hash },
            ],
        });
        if (grant) {
            await this.grantSessions.revokeGrant(ctx, grant);
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
        await this.grantSessions.revokeGrant(ctx, grant);
        return true;
    }

    /** No channel filter: consent belongs to the person, not the storefront it was given on, so a customer sees every grant regardless of channel. */
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

    /** Uses the same error for an unknown grant and one owned by someone else, so a caller can't tell the two apart. */
    async revokeCustomerGrant(ctx: RequestContext, grantId: ID): Promise<boolean> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedException('Revoking an MCP client grant requires a signed-in customer');
        }
        const grant = await this.connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { id: grantId } });
        if (grant?.actorType !== 'customer' || !idsAreEqual(grant.actorId, ctx.activeUserId)) {
            throw new EntityNotFoundError('McpOauthGrant', grantId);
        }
        await this.grantSessions.revokeGrant(ctx, grant);
        return true;
    }

    async authenticateBearerToken(
        token: string,
        apiType: McpToolset,
        req?: I18nRequest,
    ): Promise<McpAuthenticatedContext> {
        const adminCtx = await this.createAdminCtx();
        const resolved = this.usableGrant(await this.findGrantAndSessionToken(adminCtx, token), apiType);
        const { grant } = resolved;

        let vendureSession = resolved.sessionToken
            ? await this.sessionService.getSessionFromToken(resolved.sessionToken)
            : undefined;
        if (!vendureSession) {
            const user = await this.userService.getUserById(adminCtx, grant.actorId);
            if (!user || user.deletedAt) {
                await this.grantSessions.revokeGrant(adminCtx, grant);
                throw new UnauthorizedException('Vendure user no longer exists');
            }
            vendureSession = await this.grantSessions.recreateGrantSession(adminCtx, grant, user);
        }

        const channel = grant.channelId
            ? await this.channelService.findOne(adminCtx, grant.channelId)
            : await this.channelService.getDefaultChannel(adminCtx);
        if (!channel) {
            await this.grantSessions.revokeGrant(adminCtx, grant);
            throw new UnauthorizedException('Channel no longer exists');
        }
        const ctx = new RequestContext({
            apiType,
            channel,
            languageCode: getLanguageCodeFromQuery(req),
            session: vendureSession,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
            req,
            translationFn: req?.t,
        });
        this.touchGrantActivity(adminCtx, grant);
        return { ctx, grant };
    }

    private usableGrant(resolved: GrantLookup | undefined, apiType: McpToolset): GrantLookup {
        if (!resolved) {
            throw new UnauthorizedException('Invalid or expired access token');
        }
        const { grant } = resolved;
        if (grant.revokedAt) {
            throw new UnauthorizedException('Access token revoked');
        }
        if (grant.accessTokenExpiresAt <= new Date()) {
            throw new McpAccessTokenExpiredError();
        }
        if (
            (apiType === 'admin' && grant.actorType !== 'admin') ||
            (apiType === 'shop' && grant.actorType !== 'customer')
        ) {
            throw new UnauthorizedException('Access token does not allow this MCP endpoint');
        }
        if (grant.resource !== this.oauthMetadata.resourceForToolset(apiType)) {
            throw new UnauthorizedException('Access token was not issued for this MCP resource');
        }
        if (grant.expiresAt <= new Date()) {
            throw new UnauthorizedException('MCP grant is expired');
        }
        return resolved;
    }

    /** Runs in the background so the request doesn't wait on it; mirrors how core updates `ApiKey.lastUsedAt`. */
    private touchGrantActivity(ctx: RequestContext, grant: McpOauthGrant): void {
        const staleBefore = new Date(Date.now() - MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS);
        if (!grant.lastActivityAt || grant.lastActivityAt < staleBefore) {
            this.connection
                .getRepository(ctx, McpOauthGrant)
                .update({ id: grant.id }, { lastActivityAt: new Date() })
                .catch(err =>
                    Logger.error(
                        `Failed to update lastActivityAt for MCP grant ${String(grant.id)}`,
                        loggerCtx,
                        err?.stack,
                    ),
                );
        }
    }

    /** Raw-selects the session token via LEFT JOIN rather than a relation, so a missing session doesn't hide an otherwise-live grant. */
    private async findGrantAndSessionToken(
        ctx: RequestContext,
        accessToken: string,
    ): Promise<GrantLookup | undefined> {
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

    /** Checks the toolset matches, so a code requested for one API can't be used to spoof a token for the other. */
    private async consumeAuthorizationRequest(
        requestToken: string,
        expectedToolset: McpToolset,
        existingCtx?: RequestContext,
    ): Promise<McpAuthorizationRequest> {
        const ctx = existingCtx ?? (await this.createAdminCtx());
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
        return request;
    }

    private async denyAuthorizationRequest(
        requestToken: string,
        expectedToolset: McpToolset,
    ): Promise<{ redirectUrl: string }> {
        const request = await this.consumeAuthorizationRequest(requestToken, expectedToolset);
        return {
            redirectUrl: appendOAuthParams(request.redirectUri, {
                error: 'access_denied',
                state: request.state ?? undefined,
            }),
        };
    }

    /** Runs both writes in one transaction so a failure midway can't leave the client with a broken redirect. */
    private async approveAuthorizationRequest(
        requestToken: string,
        expectedToolset: McpToolset,
        approver: { actorId: ID; actorType: McpGrantUserType; channelId: ID | null },
    ): Promise<{ redirectUrl: string }> {
        const ctx = await this.createAdminCtx();
        const { actorId, actorType, channelId } = approver;
        const codePlaintext = randomToken();
        const consented = await this.connection.withTransaction(ctx, async txCtx => {
            const request = await this.consumeAuthorizationRequest(requestToken, expectedToolset, txCtx);
            await this.connection.getRepository(txCtx, McpAuthorizationCode).save(
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
            return { redirectUri: request.redirectUri, state: request.state };
        });
        return {
            redirectUrl: appendOAuthParams(consented.redirectUri, {
                code: codePlaintext,
                state: consented.state ?? undefined,
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
            throw new McpOauthError(
                'invalid_request',
                'code, client_id, redirect_uri, code_verifier and resource are required',
            );
        }
        const { resource } = this.oauthMetadata.resolveResource(input.resource);
        const ctx = await this.createAdminCtx();
        const codeRepo = this.connection.getRepository(ctx, McpAuthorizationCode);
        const codeHash = this.hashLookup(input.code);
        const code = await codeRepo.findOne({
            where: { code: codeHash },
            relations: ['oauthClient'],
        });
        if (!code || code.expiresAt <= new Date()) {
            throw new McpOauthError('invalid_grant', 'Authorization code invalid or expired');
        }
        if (code.oauthClient.clientId !== input.client_id || code.redirectUri !== input.redirect_uri) {
            throw new McpOauthError(
                'invalid_grant',
                'Authorization code does not match client or redirect_uri',
            );
        }
        if (code.resource !== resource) {
            throw new McpOauthError(
                'invalid_grant',
                'Authorization code does not match token request resource',
            );
        }
        if (!verifyPkceChallenge(input.code_verifier, code.codeChallenge)) {
            throw new McpOauthError('invalid_grant', 'Invalid PKCE verifier');
        }
        // One transaction: otherwise a failure between claiming the code and issuing tokens would
        // burn the client's one exchange attempt and orphan the session just created.
        return this.connection.withTransaction(ctx, async txCtx => {
            const claim = await this.connection
                .getRepository(txCtx, McpAuthorizationCode)
                .createQueryBuilder()
                .delete()
                .where('code = :code', { code: codeHash })
                .execute();
            if (!claim.affected) {
                throw new McpOauthError('invalid_grant', 'Authorization code invalid or expired');
            }
            return this.issueTokenPair(
                txCtx,
                code.oauthClient,
                code.actorId,
                code.actorType,
                code.resource,
                code.channelId,
            );
        });
    }

    private async exchangeRefreshToken(input: TokenInput) {
        const oauth = this.resolvedOauth();
        if (!input.refresh_token || !input.client_id) {
            throw new McpOauthError('invalid_request', 'refresh_token and client_id are required');
        }
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
            if (reused) {
                await this.grantSessions.revokeGrant(ctx, reused);
            }
            throw new McpOauthError('invalid_grant', 'Refresh token invalid or expired');
        }
        if (grant.revokedAt || grant.expiresAt <= new Date()) {
            throw new McpOauthError('invalid_grant', 'Refresh token invalid or expired');
        }
        if (grant.oauthClient.clientId !== input.client_id) {
            throw new McpOauthError('invalid_grant', 'Refresh token does not match client');
        }
        // RFC 8707 asks a client to name the resource on a refresh but does not require it, so a
        // request that leaves it out is refreshing for the resource the grant already names.
        if (input.resource) {
            const { resource } = this.oauthMetadata.resolveResource(input.resource);
            if (grant.resource !== resource) {
                throw new McpOauthError(
                    'invalid_grant',
                    'Refresh token does not match token request resource',
                );
            }
        }

        const now = new Date();
        const accessPlaintext = randomToken();
        const refreshPlaintext = randomToken();
        await this.connection.withTransaction(ctx, async txCtx => {
            // If two requests race to rotate the same refresh token, only one UPDATE matches and
            // the other is rejected; the old hash is kept so replaying it is recognized as reuse.
            const claim = await this.connection
                .getRepository(txCtx, McpOauthGrant)
                .createQueryBuilder()
                .update(McpOauthGrant)
                .set({
                    accessTokenHash: this.hashLookup(accessPlaintext),
                    refreshTokenHash: this.hashLookup(refreshPlaintext),
                    previousRefreshTokenHash: refreshTokenHash,
                    accessTokenExpiresAt: addSeconds(now, oauth.accessTokenTtlSeconds),
                    expiresAt: addSeconds(now, oauth.refreshTokenTtlSeconds),
                    lastActivityAt: now,
                })
                .where('id = :id', { id: grant.id })
                .andWhere('refreshTokenHash = :refreshTokenHash', { refreshTokenHash })
                .andWhere('revokedAt IS NULL')
                .execute();
            if (!claim.affected) {
                throw new McpOauthError('invalid_grant', 'Refresh token invalid or expired');
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
        channelId: ID | null,
    ): Promise<OAuthTokenResponse> {
        const oauth = this.resolvedOauth();
        // Checked here too (not just on session re-creation) because `getUserById` returns
        // soft-deleted users, and a code can outlive the account that approved it.
        const user = await this.userService.getUserById(ctx, actorId);
        if (!user || user.deletedAt) {
            throw new McpOauthError('invalid_grant', 'Vendure user no longer exists');
        }
        const now = new Date();
        const accessPlaintext = randomToken();
        const refreshPlaintext = randomToken();
        const createdSession = await this.grantSessions.createVendureSession(ctx, user);
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
                accessTokenExpiresAt: addSeconds(now, oauth.accessTokenTtlSeconds),
                expiresAt: addSeconds(now, oauth.refreshTokenTtlSeconds),
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
        ctx: RequestContext,
    ): Promise<McpAuthorizationRequest> {
        const request = await this.connection.getRepository(ctx, McpAuthorizationRequest).findOne({
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

    /** Expects the Vendure server's own origin, since Vendure serves the admin consent page itself. */
    private assertConsentRequestOrigin(ctx: RequestContext): void {
        this.assertOriginMatches(
            ctx,
            new URL(this.resolvedOauth().issuer).origin,
            'Admin consent must be submitted from the Vendure consent page',
        );
    }

    /** Expects the merchant's storefront consent page origin; a server-rendered page with no `Origin` header is allowed through. */
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

    /** Blocks a cross-site request from riding a signed-in user's session, by requiring the `Origin` header to match when the browser sends one. */
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

    /** See {@link resolvedOauthOptions}. */
    private resolvedOauth(): McpOauthOptionsWithIssuer {
        return resolvedOauthOptions(this.options);
    }

    /** Derived once and cached, since re-deriving the key for every hash would be expensive. */
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
