import { Controller, Get, Query } from '@nestjs/common';
import { Mutation, Resolver } from '@nestjs/graphql';
import { LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    Allow,
    ApiKeyService,
    AuthService,
    Ctx,
    InternalServerError,
    PluginCommonModule,
    RequestContext,
    RequestContextService,
    SessionService,
    Transaction,
    UserService,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

/**
 * The SuperAdmin Role in the e2e seed data.
 */
const SUPER_ADMIN_ROLE_ID = '1';

/**
 * Test fixture only. These routes are unauthenticated and mint privileged sessions and API-Keys from a
 * query-string identifier, which is what makes the session apiType observable. Never copy this shape
 * into a plugin.
 *
 * Simulates an SSO callback implemented as a REST route: the request's own apiType is 'custom', but
 * the callback authenticates against the Shop API strategy list. The session must therefore belong to
 * the Shop API, not to the API the request arrived on.
 */
@Controller('test-session')
export class SessionApiTypeTestController {
    constructor(
        private apiKeyService: ApiKeyService,
        private authService: AuthService,
        private requestContextService: RequestContextService,
        private sessionService: SessionService,
        private userService: UserService,
    ) {}

    @Get('shop-sso-callback')
    async shopSsoCallback(@Ctx() ctx: RequestContext, @Query('email') email: string) {
        const result = await this.authService.authenticate(ctx, 'shop', 'test_sso_strategy_admin', {
            email,
        });
        return { token: 'token' in result ? result.token : null };
    }

    /**
     * Creates a session without passing an apiType, so the session records the request's own
     * apiType, which is 'custom' for a REST route.
     */
    @Get('custom-session')
    async customSession(@Ctx() ctx: RequestContext, @Query('identifier') identifier: string) {
        const user = await this.userService.getUserByEmailAddress(ctx, identifier, 'administrator');
        if (!user) {
            return { token: null };
        }
        const session = await this.sessionService.createNewAuthenticatedSession(ctx, user, 'native');
        return { token: session.token };
    }

    /**
     * Creates a session from a context built outside the request-response cycle, which is how a plugin
     * builds one in a start-up script. Such a context carries no request, so its apiType 'admin' is a
     * placeholder: the session records 'shop' and the Admin API refuses it.
     *
     * With `?apiType=admin` the route passes the argument the docs tell plugin authors to pass, and
     * the session works on the Admin API.
     */
    @Get('synthetic-session')
    async syntheticSession(
        @Query('identifier') identifier: string,
        @Query('apiType') apiType?: 'admin' | 'shop',
    ) {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const user = await this.userService.getUserByEmailAddress(ctx, identifier, 'administrator');
        if (!user) {
            throw new InternalServerError(`No administrator User for identifier ${identifier}`);
        }
        const session = await this.sessionService.createNewAuthenticatedSession(
            ctx,
            user,
            'native',
            undefined,
            apiType,
        );
        return { token: session.token };
    }

    /**
     * The same, from the context RequestContext.empty() returns, which is the constructor the
     * SessionService docs name.
     */
    @Get('empty-context-session')
    async emptyContextSession(@Query('identifier') identifier: string) {
        const ctx = RequestContext.empty();
        const user = await this.userService.getUserByEmailAddress(ctx, identifier, 'administrator');
        if (!user) {
            throw new InternalServerError(`No administrator User for identifier ${identifier}`);
        }
        const session = await this.sessionService.createNewAuthenticatedSession(ctx, user, 'native');
        return { token: session.token };
    }

    /**
     * Creates an API-Key from a context built outside the request-response cycle. Only a request which
     * arrived on the Admin API creates an Admin API key, so this key records 'shop'.
     */
    @Get('synthetic-api-key')
    async syntheticApiKey(@Query('identifier') identifier: string) {
        const lookupCtx = await this.requestContextService.create({ apiType: 'admin' });
        const user = await this.userService.getUserByEmailAddress(lookupCtx, identifier, 'administrator');
        if (!user) {
            throw new InternalServerError(`No administrator User for identifier ${identifier}`);
        }
        // The context must act as the User, or ApiKeyService refuses to grant the role.
        const ctx = await this.requestContextService.create({ apiType: 'admin', user });
        return { apiKey: await this.createKey(ctx, 'Synthetic context key') };
    }

    /**
     * Creates an API-Key from the REST route's own context, whose apiType is 'custom'. The shop api-key
     * strategy hashes such a key, so it records 'shop' and not 'custom'.
     */
    @Get('rest-context-api-key')
    async restContextApiKey(@Ctx() ctx: RequestContext, @Query('identifier') identifier: string) {
        const user = await this.userService.getUserByEmailAddress(ctx, identifier, 'administrator');
        if (!user) {
            throw new InternalServerError(`No administrator User for identifier ${identifier}`);
        }
        const keyCtx = await this.requestContextService.create({
            apiType: ctx.apiType,
            req: ctx.req,
            user,
        });
        return { apiKey: await this.createKey(keyCtx, 'REST context key') };
    }

    private async createKey(ctx: RequestContext, name: string) {
        if (!ctx.activeUserId) {
            throw new InternalServerError('error.active-user-does-not-have-sufficient-permissions');
        }
        const result = await this.apiKeyService.create(
            ctx,
            {
                roleIds: [SUPER_ADMIN_ROLE_ID],
                translations: [{ languageCode: LanguageCode.en, name }],
            },
            ctx.activeUserId,
        );
        return result.apiKey;
    }

    @Allow(Permission.Authenticated)
    @Get('restricted')
    restrictedRoute() {
        return 'success';
    }

    /**
     * A REST route gated by an administrator permission. The Admin API check does not run on REST
     * routes, so this route still accepts a Shop-created administrator session. The e2e test pins
     * that documented gap.
     */
    @Allow(Permission.ReadAdministrator)
    @Get('admin-restricted')
    adminRestrictedRoute() {
        return 'admin-success';
    }
}

/**
 * Exposes ApiKeyService.create() on the Shop API, which the shopApiKeyStrategy config option exists
 * to support. The session minted for such a key records apiType 'shop', so the key must be refused
 * by the Admin API.
 */
@Resolver()
export class ShopApiKeyTestResolver {
    constructor(private apiKeyService: ApiKeyService) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    async createTestShopApiKey(@Ctx() ctx: RequestContext): Promise<string> {
        if (!ctx.activeUserId) {
            throw new InternalServerError('error.active-user-does-not-have-sufficient-permissions');
        }
        const result = await this.apiKeyService.create(
            ctx,
            {
                roleIds: [SUPER_ADMIN_ROLE_ID],
                translations: [{ languageCode: LanguageCode.en, name: 'Shop-context key' }],
            },
            ctx.activeUserId,
        );
        return result.apiKey;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [SessionApiTypeTestController],
    shopApiExtensions: {
        schema: gql`
            extend type Mutation {
                createTestShopApiKey: String!
            }
        `,
        resolvers: [ShopApiKeyTestResolver],
    },
})
export class SessionApiTypeTestPlugin {}
