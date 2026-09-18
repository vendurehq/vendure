import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { ApiType } from '../../api/common/get-api-type';
import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import { InvalidCredentialsError } from '../../common/error/generated-graphql-admin-errors';
import {
    NotVerifiedError,
    InvalidCredentialsError as ShopInvalidCredentialsError,
} from '../../common/error/generated-graphql-shop-errors';
import { Instrument } from '../../common/instrument-decorator';
import { AuthenticationStrategy } from '../../config/auth/authentication-strategy';
import {
    NATIVE_AUTH_STRATEGY_NAME,
    NativeAuthenticationData,
    NativeAuthenticationStrategy,
} from '../../config/auth/native-authentication-strategy';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ExternalAuthenticationMethod } from '../../entity/authentication-method/external-authentication-method.entity';
import { AuthenticatedSession } from '../../entity/session/authenticated-session.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus/event-bus';
import { AttemptedLoginEvent } from '../../event-bus/events/attempted-login-event';
import { LoginEvent } from '../../event-bus/events/login-event';
import { LogoutEvent } from '../../event-bus/events/logout-event';

import { SessionService } from './session.service';

/**
 * @description
 * Contains methods relating to {@link Session}, {@link AuthenticatedSession} & {@link AnonymousSession} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class AuthService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private sessionService: SessionService,
        private eventBus: EventBus,
    ) {}

    /**
     * @description
     * Authenticates a user's credentials and if okay, creates a new {@link AuthenticatedSession}.
     */
    async authenticate(
        ctx: RequestContext,
        apiType: ApiType,
        authenticationMethod: string,
        authenticationData: any,
    ): Promise<AuthenticatedSession | InvalidCredentialsError | NotVerifiedError> {
        await this.eventBus.publish(
            new AttemptedLoginEvent(
                ctx,
                authenticationMethod,
                authenticationMethod === NATIVE_AUTH_STRATEGY_NAME
                    ? (authenticationData as NativeAuthenticationData).username
                    : undefined,
            ),
        );
        const authenticationStrategy = this.getAuthenticationStrategy(apiType, authenticationMethod);
        const authenticateResult = await authenticationStrategy.authenticate(ctx, authenticationData);
        if (typeof authenticateResult === 'string') {
            return new InvalidCredentialsError({ authenticationError: authenticateResult });
        }
        if (!authenticateResult) {
            return new InvalidCredentialsError({ authenticationError: '' });
        }
        return this.createAuthenticatedSessionForUser(
            ctx,
            authenticateResult,
            authenticationStrategy.name,
            apiType,
        );
    }

    /**
     * @description
     * Creates a new {@link AuthenticatedSession} for the given User.
     *
     * The `apiType` argument is passed through to `SessionService.createNewAuthenticatedSession()`,
     * whose docs describe when to pass it.
     */
    async createAuthenticatedSessionForUser(
        ctx: RequestContext,
        user: User,
        authenticationStrategyName: string,
        apiType?: ApiType,
    ): Promise<AuthenticatedSession | NotVerifiedError> {
        if (!user.roles || !user.roles[0]?.channels) {
            const userWithRoles = await this.connection
                .getRepository(ctx, User)
                .createQueryBuilder('user')
                .leftJoinAndSelect('user.roles', 'role')
                .leftJoinAndSelect('role.channels', 'channel')
                .where('user.id = :userId', { userId: user.id })
                .getOne();
            user.roles = userWithRoles?.roles || [];
        }
        if (!user.authenticationMethods) {
            // The verification backstop below depends on the auth methods being loaded. If a caller
            // (e.g. a plugin) passes a User without them, load them here rather than let the security
            // check silently no-op, mirroring the roles reload above.
            const userWithAuth = await this.connection
                .getRepository(ctx, User)
                .createQueryBuilder('user')
                .leftJoinAndSelect('user.authenticationMethods', 'authMethod')
                .where('user.id = :userId', { userId: user.id })
                .getOne();
            user.authenticationMethods = userWithAuth?.authenticationMethods || [];
        }

        // Per-credential native verification, as defense in depth. An unverified account whose native
        // credential still carries a verificationToken has no proof that whoever set the password owns
        // the identifier. Refuse it whatever the account's other authentication methods are, and
        // whatever `requireVerification` is set to. This closes the cross-auth bypass that the
        // `!extAuths.length` condition below does not detect. It also covers an install that switches
        // `requireVerification` off while such a credential is still pending. The primary fix is in
        // `CustomerService.registerCustomerAccount`, which never stores a caller-supplied password on
        // such a credential.
        //
        // The `verified` condition matters. A verified account can carry a token beside a real
        // password, because `resetPasswordByToken` in earlier releases set `verified` without clearing
        // the token. Those customers chose that password themselves, so refusing them would be a
        // lockout with no security gain (GHSA-wr5h-x3x6-4h23).
        const isNativeLogin = authenticationStrategyName === NATIVE_AUTH_STRATEGY_NAME;
        if (isNativeLogin && !user.verified) {
            const nativeAuthMethod = user.getNativeAuthenticationMethod(false);
            if (nativeAuthMethod && nativeAuthMethod.verificationToken != null) {
                return new NotVerifiedError();
            }
        }
        const extAuths = (user.authenticationMethods ?? []).filter(
            am => am instanceof ExternalAuthenticationMethod,
        );
        // The external carve-out exists so that a User who signs in through an external provider is not
        // blocked by the native `verified` flag, which that provider never sets. It must never apply to
        // a native login: otherwise an unverified native credential authenticates simply because the
        // account also has an external method (GHSA-wr5h-x3x6-4h23).
        if (
            (isNativeLogin || !extAuths.length) &&
            this.configService.authOptions.requireVerification &&
            !user.verified
        ) {
            return new NotVerifiedError();
        }
        if (ctx.session && ctx.session.activeOrderId) {
            await this.sessionService.deleteSessionsByActiveOrderId(ctx, ctx.session.activeOrderId);
        }
        if (!this.configService.authOptions.disableLastLoginUpdate) {
            user.lastLogin = new Date();
        }
        // The save is unconditional: an AuthenticationStrategy may have set fields on the
        // User (e.g. `verified`, custom fields) which this is the only place to persist.
        // With no changed columns, TypeORM issues no UPDATE, so the `user` row is not written.
        await this.connection.getRepository(ctx, User).save(user);
        const session = await this.sessionService.createNewAuthenticatedSession(
            ctx,
            user,
            authenticationStrategyName,
            undefined,
            apiType,
        );
        await this.eventBus.publish(new LoginEvent(ctx, user));
        return session;
    }

    /**
     * @description
     * Verify the provided password against the one we have for the given user. Requires
     * the {@link NativeAuthenticationStrategy} to be configured.
     */
    async verifyUserPassword(
        ctx: RequestContext,
        userId: ID,
        password: string,
    ): Promise<boolean | InvalidCredentialsError | ShopInvalidCredentialsError> {
        const nativeAuthenticationStrategy = this.getAuthenticationStrategy(
            'shop',
            NATIVE_AUTH_STRATEGY_NAME,
        );
        const passwordMatches = await nativeAuthenticationStrategy.verifyUserPassword(ctx, userId, password);
        if (!passwordMatches) {
            return new InvalidCredentialsError({ authenticationError: '' });
        }
        return true;
    }

    /**
     * @description
     * Deletes all sessions for the user associated with the given session token.
     */
    async destroyAuthenticatedSession(ctx: RequestContext, sessionToken: string): Promise<void> {
        const session = await this.connection.getRepository(ctx, AuthenticatedSession).findOne({
            where: { token: sessionToken },
            relations: { user: { authenticationMethods: true } },
        });

        if (session) {
            const authenticationStrategy = this.getAuthenticationStrategy(
                ctx.apiType,
                session.authenticationStrategy,
            );
            if (typeof authenticationStrategy.onLogOut === 'function') {
                await authenticationStrategy.onLogOut(ctx, session.user);
            }
            await this.eventBus.publish(new LogoutEvent(ctx));
            return this.sessionService.deleteSessionsByUser(ctx, session.user);
        }
    }

    private getAuthenticationStrategy(
        apiType: ApiType,
        method: typeof NATIVE_AUTH_STRATEGY_NAME,
    ): NativeAuthenticationStrategy;
    private getAuthenticationStrategy(apiType: ApiType, method: string): AuthenticationStrategy;
    private getAuthenticationStrategy(apiType: ApiType, method: string): AuthenticationStrategy {
        const { authOptions } = this.configService;
        const strategies =
            apiType === 'admin'
                ? authOptions.adminAuthenticationStrategy
                : authOptions.shopAuthenticationStrategy;
        const match = strategies.find(s => s.name === method);
        if (!match) {
            throw new InternalServerError('error.unrecognized-authentication-strategy', { name: method });
        }
        return match;
    }
}
