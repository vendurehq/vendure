import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    AuthenticationResult,
    MutationAuthenticateArgs,
    MutationLoginArgs,
    NativeAuthenticationResult,
    Permission,
    Success,
} from '@vendure/common/lib/generated-types';
import { Request, Response } from 'express';

import { NativeAuthStrategyError } from '../../../common/error/generated-graphql-admin-errors';
import { NATIVE_AUTH_STRATEGY_NAME } from '../../../config/auth/native-authentication-strategy';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { AdministratorService } from '../../../service/services/administrator.service';
import { ApiKeyService } from '../../../service/services/api-key.service';
import { AuthService } from '../../../service/services/auth.service';
import { UserService } from '../../../service/services/user.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';
import { BaseAuthResolver } from '../base/base-auth.resolver';

@Resolver()
export class AuthResolver extends BaseAuthResolver {
    constructor(
        authService: AuthService,
        userService: UserService,
        configService: ConfigService,
        administratorService: AdministratorService,
        apiKeyService: ApiKeyService,
    ) {
        super(authService, userService, administratorService, configService, apiKeyService);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    async login(
        @Args() args: MutationLoginArgs,
        @Ctx() ctx: RequestContext,
        @Context('req') req: Request,
        @Context('res') res: Response,
    ): Promise<NativeAuthenticationResult> {
        const nativeAuthStrategyError = this.requireNativeAuthStrategy();
        if (nativeAuthStrategyError) {
            return nativeAuthStrategyError;
        }
        return (await super.baseLogin(args, ctx, req, res)) as AuthenticationResult;
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    async authenticate(
        @Args() args: MutationAuthenticateArgs,
        @Ctx() ctx: RequestContext,
        @Context('req') req: Request,
        @Context('res') res: Response,
    ): Promise<AuthenticationResult> {
        return (await this.authenticateAndCreateSession(ctx, args, req, res)) as AuthenticationResult;
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Public)
    logout(
        @Ctx() ctx: RequestContext,
        @Context('req') req: Request,
        @Context('res') res: Response,
    ): Promise<Success> {
        return super.logout(ctx, req, res);
    }

    @Query()
    @Allow(Permission.Authenticated, Permission.Owner)
    me(@Ctx() ctx: RequestContext) {
        return super.me(ctx, 'admin');
    }

    protected requireNativeAuthStrategy() {
        const { adminAuthenticationStrategy } = this.configService.authOptions;
        const nativeAuthStrategyIsConfigured = !!adminAuthenticationStrategy.find(
            strategy => strategy.name === NATIVE_AUTH_STRATEGY_NAME,
        );
        if (!nativeAuthStrategyIsConfigured) {
            const authStrategyNames = adminAuthenticationStrategy.map(s => s.name).join(', ');
            const errorMessage =
                'This GraphQL operation requires that the NativeAuthenticationStrategy be configured for the Admin API.\n' +
                `Currently the following AuthenticationStrategies are enabled: ${authStrategyNames}`;
            Logger.error(errorMessage);
            return new NativeAuthStrategyError();
        }
    }
}
