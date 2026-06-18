import {
    PasswordValidationError,
    AuthenticationResult as ShopAuthenticationResult,
} from '@vendure/common/lib/generated-shop-types';
import {
    AuthenticationResult as AdminAuthenticationResult,
    CurrentUser,
    CurrentUserChannel,
    MutationAuthenticateArgs,
    MutationLoginArgs,
    Success,
} from '@vendure/common/lib/generated-types';
import { Request, Response } from 'express';

import { isGraphQlErrorResult } from '../../../common/error/error-result';
import { ForbiddenError } from '../../../common/error/errors';
import {
    InvalidCredentialsError,
    NotVerifiedError,
} from '../../../common/error/generated-graphql-shop-errors';
import { NATIVE_AUTH_STRATEGY_NAME } from '../../../config/auth/native-authentication-strategy';
import { ConfigService } from '../../../config/config.service';
import { LogLevel } from '../../../config/logger/vendure-logger';
import { User } from '../../../entity/user/user.entity';
import { getUserChannelsPermissions } from '../../../service/helpers/utils/get-user-channels-permissions';
import { AdministratorService } from '../../../service/services/administrator.service';
import { ApiKeyService } from '../../../service/services/api-key.service';
import { AuthService } from '../../../service/services/auth.service';
import { UserService } from '../../../service/services/user.service';
import { extractSessionToken } from '../../common/extract-session-token';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { setSessionToken } from '../../common/set-session-token';

export class BaseAuthResolver {
    constructor(
        protected authService: AuthService,
        protected userService: UserService,
        protected administratorService: AdministratorService,
        protected configService: ConfigService,
        protected apiKeyService: ApiKeyService,
    ) {}

    /**
     * Attempts a login given the username and password of a user. If successful, returns
     * the user data and returns the token either in a cookie or in the response body.
     */
    async baseLogin(
        args: MutationLoginArgs,
        ctx: RequestContext,
        req: Request,
        res: Response,
    ): Promise<AdminAuthenticationResult | ShopAuthenticationResult | NotVerifiedError> {
        return await this.authenticateAndCreateSession(
            ctx,
            {
                input: { [NATIVE_AUTH_STRATEGY_NAME]: args },
                rememberMe: args.rememberMe,
            },
            req,
            res,
        );
    }

    async logout(ctx: RequestContext, req: Request, res: Response): Promise<Success> {
        const extraction = extractSessionToken(
            req,
            this.configService.authOptions.tokenMethod,
            this.configService.authOptions.apiKeyHeaderKey,
        );

        // ApiKey "Sessions" are not meant to be logged out of
        if (!extraction?.token || extraction.method === 'api-key') {
            return { success: false };
        }

        await this.authService.destroyAuthenticatedSession(ctx, extraction.token);

        setSessionToken({
            req,
            res,
            authOptions: this.configService.authOptions,
            rememberMe: false,
            sessionToken: '',
        });

        return { success: true };
    }

    /**
     * Returns information about the current authenticated user.
     */
    async me(ctx: RequestContext, apiType: ApiType) {
        const userId = ctx.activeUserId;
        if (!userId) {
            throw new ForbiddenError(LogLevel.Verbose);
        }
        if (apiType === 'admin') {
            const administrator = await this.administratorService.findOneByUserId(ctx, userId);
            if (!administrator) {
                throw new ForbiddenError(LogLevel.Verbose);
            }
        }
        const user = userId && (await this.userService.getUserById(ctx, userId));
        return user ? this.publiclyAccessibleUser(user) : null;
    }

    /**
     * Creates an authenticated session and sets the session token.
     */
    protected async authenticateAndCreateSession(
        ctx: RequestContext,
        args: MutationAuthenticateArgs,
        req: Request,
        res: Response,
    ): Promise<AdminAuthenticationResult | ShopAuthenticationResult | NotVerifiedError> {
        const [method, data] = Object.entries(args.input)[0];
        const { apiType } = ctx;
        const session = await this.authService.authenticate(ctx, apiType, method, data);
        if (isGraphQlErrorResult(session)) {
            return session;
        }
        if (apiType && apiType === 'admin') {
            const administrator = await this.administratorService.findOneByUserId(ctx, session.user.id);
            if (!administrator) {
                return new InvalidCredentialsError({ authenticationError: '' });
            }
        }
        setSessionToken({
            req,
            res,
            authOptions: this.configService.authOptions,
            rememberMe: args.rememberMe || false,
            sessionToken: session.token,
        });
        return this.publiclyAccessibleUser(session.user);
    }

    /**
     * Updates the password of an existing User.
     */
    protected async updatePassword(
        ctx: RequestContext,
        currentPassword: string,
        newPassword: string,
    ): Promise<boolean | InvalidCredentialsError | PasswordValidationError> {
        const { activeUserId } = ctx;
        if (!activeUserId) {
            throw new ForbiddenError();
        }
        return this.userService.updatePassword(ctx, activeUserId, currentPassword, newPassword);
    }

    /**
     * Exposes a subset of the User properties which we want to expose to the public API.
     */
    protected publiclyAccessibleUser(user: User): CurrentUser {
        return {
            id: user.id,
            identifier: user.identifier,
            channels: getUserChannelsPermissions(user) as CurrentUserChannel[],
        };
    }
}
