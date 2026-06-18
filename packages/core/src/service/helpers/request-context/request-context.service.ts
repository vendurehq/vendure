import { Injectable } from '@nestjs/common';
import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { Request } from 'express';
import { GraphQLResolveInfo } from 'graphql';
import ms from 'ms';

import { ApiType, getApiType } from '../../../api/common/get-api-type';
import { RequestContext } from '../../../api/common/request-context';
import { UserInputError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { CachedSession, CachedSessionUser } from '../../../config/session-cache/session-cache-strategy';
import { Channel } from '../../../entity/channel/channel.entity';
import { User } from '../../../entity/user/user.entity';
import { ChannelService } from '../../services/channel.service';
import { getUserChannelsPermissions } from '../utils/get-user-channels-permissions';

/**
 * @description
 * Creates new {@link RequestContext} instances.
 *
 * @docsCategory request
 */
@Injectable()
export class RequestContextService {
    /** @internal */
    constructor(
        private channelService: ChannelService,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * Creates a RequestContext based on the config provided. This can be useful when interacting
     * with services outside the request-response cycle, for example in stand-alone scripts or in
     * worker jobs.
     *
     * @since 1.5.0
     */
    async create(config: {
        req?: Request;
        apiType: ApiType;
        channelOrToken?: Channel | string;
        languageCode?: LanguageCode;
        currencyCode?: CurrencyCode;
        user?: User;
        activeOrderId?: ID;
    }): Promise<RequestContext> {
        const { req, apiType, channelOrToken, languageCode, currencyCode, user, activeOrderId } = config;
        let channel: Channel;
        if (channelOrToken instanceof Channel) {
            channel = channelOrToken;
        } else if (typeof channelOrToken === 'string') {
            channel = await this.channelService.getChannelFromToken(channelOrToken);
        } else {
            channel = await this.channelService.getDefaultChannel();
        }
        let session: CachedSession | undefined;
        if (user) {
            const channelPermissions = user.roles ? getUserChannelsPermissions(user) : [];
            session = {
                user: {
                    id: user.id,
                    identifier: user.identifier,
                    verified: user.verified,
                    channelPermissions,
                },
                id: '__dummy_session_id__',
                token: '__dummy_session_token__',
                expires: new Date(Date.now() + ms('1y')),
                cacheExpiry: ms('1y'),
                activeOrderId,
            };
        }
        return new RequestContext({
            req,
            apiType,
            channel,
            languageCode,
            currencyCode,
            session,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }

    /**
     * @description
     * Creates a new RequestContext based on an Express request object. This is used internally
     * in the API layer by the AuthGuard, and creates the RequestContext which is then passed
     * to all resolvers & controllers.
     */
    async fromRequest(
        req: Request,
        info?: GraphQLResolveInfo,
        requiredPermissions?: Permission[],
        session?: CachedSession,
    ): Promise<RequestContext> {
        const channelToken = this.getChannelToken(req);
        const channel = await this.channelService.getChannelFromToken(channelToken);
        const apiType = getApiType(info);

        const hasOwnerPermission = !!requiredPermissions && requiredPermissions.includes(Permission.Owner);
        const languageCode = this.getLanguageCode(req, channel);
        const currencyCode = this.getCurrencyCode(req, channel);
        const user = session && session.user;
        const isAuthorized = this.userHasRequiredPermissionsOnChannel(requiredPermissions, channel, user);
        const authorizedAsOwnerOnly = !isAuthorized && hasOwnerPermission;
        const translationFn = (req as any).t;
        return new RequestContext({
            req,
            apiType,
            channel,
            languageCode,
            currencyCode,
            session,
            isAuthorized,
            authorizedAsOwnerOnly,
            translationFn,
        });
    }

    private getChannelToken(req: Request<any, any, any, { [key: string]: any }>): string {
        const tokenKey = this.configService.apiOptions.channelTokenKey;
        let channelToken = '';

        if (req && req.query && req.query[tokenKey]) {
            channelToken = req.query[tokenKey];
        } else if (req && req.headers && req.headers[tokenKey]) {
            channelToken = req.headers[tokenKey] as string;
        }
        return channelToken;
    }

    private getLanguageCode(req: Request, channel: Channel): LanguageCode | undefined {
        const queryLanguageCode = req.query?.languageCode as string | undefined;
        // We use a format check rather than an enum check to allow for custom/extended
        // language codes while still blocking any SQL injection payloads.
        const isValidFormat = queryLanguageCode && /^[a-zA-Z0-9_-]+$/.test(queryLanguageCode);
        return (
            (isValidFormat ? (queryLanguageCode as LanguageCode) : undefined) ??
            channel.defaultLanguageCode ??
            this.configService.defaultLanguageCode
        );
    }

    private getCurrencyCode(req: Request, channel: Channel): CurrencyCode | undefined {
        const queryCurrencyCode = req.query && (req.query.currencyCode as CurrencyCode);
        if (queryCurrencyCode && !channel.availableCurrencyCodes.includes(queryCurrencyCode)) {
            throw new UserInputError('error.currency-not-available-in-channel', {
                currencyCode: queryCurrencyCode,
            });
        }
        return queryCurrencyCode ?? channel.defaultCurrencyCode;
    }

    /**
     * TODO: Deprecate and remove, since this function is now handled internally in the RequestContext.
     * @private
     */
    private userHasRequiredPermissionsOnChannel(
        permissions: Permission[] = [],
        channel?: Channel,
        user?: CachedSessionUser,
    ): boolean {
        if (!user || !channel) {
            return false;
        }
        const permissionsOnChannel = user.channelPermissions.find(c => idsAreEqual(c.id, channel.id));
        if (permissionsOnChannel) {
            return this.arraysIntersect(permissionsOnChannel.permissions, permissions);
        }
        return false;
    }

    /**
     * Returns true if any element of arr1 appears in arr2.
     */
    private arraysIntersect<T>(arr1: T[], arr2: T[]): boolean {
        return arr1.reduce((intersects, role) => {
            return intersects || arr2.includes(role);
        }, false as boolean);
    }
}
