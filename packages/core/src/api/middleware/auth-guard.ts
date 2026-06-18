import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@vendure/common/lib/generated-types';
import { Request, Response } from 'express';
import { GraphQLResolveInfo } from 'graphql';
import ms, { type StringValue } from 'ms';

import { ForbiddenError } from '../../common/error/errors';
import { API_KEY_AUTH_STRATEGY_NAME } from '../../config';
import { ConfigService } from '../../config/config.service';
import { Logger, LogLevel } from '../../config/logger/vendure-logger';
import { CachedSession } from '../../config/session-cache/session-cache-strategy';
import { Customer } from '../../entity/customer/customer.entity';
import { RequestContextService } from '../../service/helpers/request-context/request-context.service';
import { ApiKeyService } from '../../service/services/api-key.service';
import { ChannelService } from '../../service/services/channel.service';
import { CustomerService } from '../../service/services/customer.service';
import { SessionService } from '../../service/services/session.service';
import { extractSessionToken, ExtractTokenResult } from '../common/extract-session-token';
import { getApiType } from '../common/get-api-type';
import { isFieldResolver } from '../common/is-field-resolver';
import { parseContext } from '../common/parse-context';
import {
    internal_getRequestContext,
    internal_setRequestContext,
    RequestContext,
} from '../common/request-context';
import { setSessionToken } from '../common/set-session-token';
import { PERMISSIONS_METADATA_KEY } from '../decorators/allow.decorator';

/**
 * @description
 * A guard which:
 *
 * 1. checks for the existence of a valid session token in the request and if found,
 * attaches the current User entity to the request.
 * 2. enforces any permissions required by the target handler (resolver, field resolver or route),
 * and throws a ForbiddenError if those permissions are not present.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private configService: ConfigService,
        private requestContextService: RequestContextService,
        private sessionService: SessionService,
        private customerService: CustomerService,
        private channelService: ChannelService,
        private apiKeyService: ApiKeyService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const { req, res, info } = parseContext(context);
        const targetIsFieldResolver = isFieldResolver(info);
        const permissions = this.reflector.get<Permission[]>(PERMISSIONS_METADATA_KEY, context.getHandler());
        if (targetIsFieldResolver && !permissions) {
            return true;
        }
        const authDisabled = this.configService.authOptions.disableAuth;
        const hasOwnerPermission = !!permissions && permissions.includes(Permission.Owner);
        let requestContext: RequestContext;
        if (targetIsFieldResolver) {
            requestContext = internal_getRequestContext(req);
        } else {
            const session = await this.getSession(req, res, hasOwnerPermission, info);
            requestContext = await this.requestContextService.fromRequest(req, info, permissions, session);

            const requestContextShouldBeReinitialized = await this.setActiveChannel(requestContext, session);
            if (requestContextShouldBeReinitialized) {
                requestContext = await this.requestContextService.fromRequest(
                    req,
                    info,
                    permissions,
                    session,
                );
            }
            internal_setRequestContext(req, requestContext, context);
        }

        if (authDisabled) {
            return true;
        }
        const strategy = this.configService.authOptions.entityAccessControlStrategy;
        const isAllowed = await strategy.canAccess(requestContext, permissions ?? []);
        if (!isAllowed) {
            throw new ForbiddenError(LogLevel.Verbose);
        }
        await strategy.prepareAccessControl?.(requestContext);
        return true;
    }

    private async setActiveChannel(
        requestContext: RequestContext,
        session?: CachedSession,
    ): Promise<boolean> {
        if (!session) {
            return false;
        }
        // In case the session does not have an activeChannelId or the activeChannelId
        // does not correspond to the current channel, the activeChannelId on the session is set
        const activeChannelShouldBeSet =
            !session.activeChannelId || session.activeChannelId !== requestContext.channelId;
        if (activeChannelShouldBeSet) {
            await this.sessionService.setActiveChannel(session, requestContext.channel);
            if (requestContext.activeUserId) {
                const customer = await this.customerService.findOneByUserId(
                    requestContext,
                    requestContext.activeUserId,
                    false,
                );
                // To avoid assigning the customer to the active channel on every request,
                // it is only done on the first request and whenever the channel changes
                if (customer) {
                    try {
                        await this.channelService.assignToChannels(requestContext, Customer, customer.id, [
                            requestContext.channelId,
                        ]);
                    } catch (e: any) {
                        const isDuplicateError =
                            e.code === 'ER_DUP_ENTRY' /* mySQL/MariaDB */ ||
                            e.code === '23505'; /* postgres */
                        if (isDuplicateError) {
                            // For a duplicate error, this means that concurrent requests have resulted in attempting to
                            // assign the Customer to the channel more than once. In this case we can safely ignore the
                            // error as the Customer was successfully assigned in the earlier call.
                            // See https://github.com/vendurehq/vendure/issues/834
                        } else {
                            throw e;
                        }
                    }
                }
            }
            return true;
        }
        return false;
    }

    private async getSession(
        req: Request,
        res: Response,
        hasOwnerPermission: boolean,
        info?: GraphQLResolveInfo,
    ): Promise<CachedSession | undefined> {
        const sessionToken = extractSessionToken(
            req,
            this.configService.authOptions.tokenMethod,
            this.configService.authOptions.apiKeyHeaderKey,
        );

        let serializedSession: CachedSession | undefined;
        if (sessionToken?.token) {
            serializedSession = await this.getSessionFromToken(req, sessionToken, info);
            if (serializedSession) {
                return serializedSession;
            }

            // if there is a token but it cannot be validated to a Session,
            // then the token is no longer valid and should be unset.
            setSessionToken({
                req,
                res,
                authOptions: this.configService.authOptions,
                rememberMe: false,
                sessionToken: '',
            });
        }

        if (hasOwnerPermission && !serializedSession) {
            serializedSession = await this.sessionService.createAnonymousSession();
            setSessionToken({
                sessionToken: serializedSession.token,
                rememberMe: true,
                authOptions: this.configService.authOptions,
                req,
                res,
            });
        }
        return serializedSession;
    }

    private async getSessionFromToken(
        req: Request,
        extracted: ExtractTokenResult,
        info?: GraphQLResolveInfo,
    ): Promise<CachedSession | undefined> {
        if (extracted.method !== 'api-key') {
            return this.sessionService.getSessionFromToken(extracted.token);
        }

        const strategy = this.apiKeyService.getApiKeyStrategyByApiType(getApiType(info));
        const parseResult = strategy.parse(extracted.token);
        if (!parseResult) {
            return;
        }

        const ctx = await this.requestContextService.fromRequest(req, info);

        const apiKey = await this.apiKeyService.findOneByLookupId(ctx, parseResult.lookupId, [
            'user',
            'user.roles',
            'user.roles.channels',
        ]);
        if (!apiKey) {
            return;
        }

        const isHashMatching = await strategy.hashingStrategy.check(extracted.token, apiKey.apiKeyHash);
        if (!isHashMatching) {
            return;
        }

        const lastUsedThreshold = new Date(
            Date.now() -
                (typeof strategy.lastUsedAtUpdateInterval === 'string'
                    ? ms(strategy.lastUsedAtUpdateInterval as StringValue)
                    : strategy.lastUsedAtUpdateInterval),
        );
        if (!apiKey.lastUsedAt || apiKey.lastUsedAt < lastUsedThreshold) {
            this.apiKeyService
                .updateLastUsedAtByLookupId(apiKey.lookupId)
                // Update the lastUsedAt timestamp in the background, we don't want to hold up the request
                .catch(err =>
                    Logger.error(
                        `Failed to update lastUsedAt for ApiKey with lookupId ${parseResult.lookupId}`,
                        undefined,
                        err?.stack,
                    ),
                );
        }

        const session = await this.sessionService.getSessionFromToken(apiKey.apiKeyHash);
        if (session) {
            return session;
        }

        // At this point we may assert:
        // 1. The token came from the api-key header
        // 2. The hash matches
        // 3. There is no session
        // We can conclude that the API-Key is actually broken.
        // For example someone could have deleted the session manually in the DB.
        // We must create a new session, otherwise the API-Key is unusable.
        await this.sessionService.createNewAuthenticatedSession(
            ctx,
            apiKey.user,
            API_KEY_AUTH_STRATEGY_NAME,
            apiKey.apiKeyHash,
        );

        return this.sessionService.getSessionFromToken(apiKey.apiKeyHash);
    }
}
