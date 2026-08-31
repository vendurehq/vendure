import {
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    RequestContext,
    RoleService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';
import { Readable } from 'stream';

export const VALID_AUTH_TOKEN = 'valid-auth-token';

const TEST_ADMIN_AVATAR = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

export type TestAuthPayload = {
    token: string;
    userData: {
        email: string;
        firstName: string;
        lastName: string;
    };
};

export class TestAuthenticationStrategy implements AuthenticationStrategy<TestAuthPayload> {
    readonly name = 'test_strategy';
    private externalAuthenticationService: ExternalAuthenticationService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestAuthInput {
                token: String!
                userData: UserDataInput
            }

            input UserDataInput {
                email: String!
                firstName: String!
                lastName: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: TestAuthPayload): Promise<User | false | string> {
        const { token, userData } = data;
        if (token === 'expired-token') {
            return 'Expired token';
        }
        if (data.token !== VALID_AUTH_TOKEN) {
            return false;
        }
        const user = await this.externalAuthenticationService.findUser(ctx, this.name, data.token);
        if (user) {
            return user;
        }
        return this.externalAuthenticationService.createCustomerAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: data.token,
            emailAddress: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            verified: true,
        });
    }
}

export class TestSSOStrategyAdmin implements AuthenticationStrategy<{ email: string }> {
    readonly name = 'test_sso_strategy_admin';
    private externalAuthenticationService: ExternalAuthenticationService;
    private roleService: RoleService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.roleService = injector.get(RoleService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestSSOInputAdmin {
                email: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: { email: string }): Promise<User | false | string> {
        const { email } = data;
        const user = await this.externalAuthenticationService.findUser(ctx, this.name, email);
        if (user) {
            return user;
        }
        const superAdminRole = await this.roleService.getSuperAdminRole();
        return this.externalAuthenticationService.createAdministratorAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: email,
            emailAddress: email,
            firstName: 'SSO Admin First Name',
            lastName: 'SSO Admin Last Name',
            identifier: email,
            roles: [superAdminRole],
            avatar: {
                filename: 'external-profile.png',
                mimetype: 'image/png',
                createReadStream: () => Readable.from([TEST_ADMIN_AVATAR]),
            },
        });
    }
}

/**
 * The same as TestSSOStrategyAdmin under a different name, so that a test can register it on the
 * Shop API only. The Admin API then has no input field for it, and a Shop-minted session is the only
 * route to the administrator's permissions on the Admin API.
 */
export class TestSSOStrategyShopOnlyAdmin implements AuthenticationStrategy<{ email: string }> {
    readonly name = 'test_sso_strategy_shop_only_admin';
    private externalAuthenticationService: ExternalAuthenticationService;
    private roleService: RoleService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.roleService = injector.get(RoleService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestSSOInputShopOnlyAdmin {
                email: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: { email: string }): Promise<User | false | string> {
        const { email } = data;
        const user = await this.externalAuthenticationService.findUser(ctx, this.name, email);
        if (user) {
            return user;
        }
        const superAdminRole = await this.roleService.getSuperAdminRole();
        return this.externalAuthenticationService.createAdministratorAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: email,
            emailAddress: email,
            firstName: 'Shop Only SSO Admin First Name',
            lastName: 'Shop Only SSO Admin Last Name',
            identifier: email,
            roles: [superAdminRole],
        });
    }
}

/**
 * Resolves a User which carries the SuperAdmin role but has no Administrator row, which
 * ExternalAuthenticationService.createUser permits. The Admin API refuses to issue a session for such
 * a User, so a Shop-minted session is the only way its permissions can reach the Admin API.
 */
export class TestSSOStrategyRoleOnly implements AuthenticationStrategy<{ email: string }> {
    readonly name = 'test_sso_strategy_role_only';
    private externalAuthenticationService: ExternalAuthenticationService;
    private roleService: RoleService;
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.roleService = injector.get(RoleService);
        this.connection = injector.get(TransactionalConnection);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestSSOInputRoleOnly {
                email: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: { email: string }): Promise<User | false | string> {
        const { email } = data;
        const existing = await this.externalAuthenticationService.findUser(ctx, this.name, email);
        if (existing) {
            return existing;
        }
        const user = await this.externalAuthenticationService.createUser(ctx, {
            strategy: this.name,
            externalIdentifier: email,
        });
        user.roles = [await this.roleService.getSuperAdminRole()];
        return this.connection.getRepository(ctx, User).save(user);
    }
}

export class TestSSOStrategyShop implements AuthenticationStrategy<{ email: string }> {
    readonly name = 'test_sso_strategy_shop';
    private externalAuthenticationService: ExternalAuthenticationService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestSSOInputShop {
                email: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: { email: string }): Promise<User | false | string> {
        const { email } = data;
        const user = await this.externalAuthenticationService.findUser(ctx, this.name, email);
        if (user) {
            return user;
        }
        return this.externalAuthenticationService.createCustomerAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: email,
            emailAddress: email,
            firstName: 'SSO Customer First Name',
            lastName: 'SSO Customer Last Name',
            verified: true,
        });
    }
}

/**
 * Simulates an external provider which forwards an email address that has NOT been verified as
 * belonging to the authenticating user (e.g. a custom OAuth provider that omits `email_verified`).
 * Used to assert that such an identity cannot be linked to a pre-existing account.
 */
export class TestUnverifiedEmailStrategy implements AuthenticationStrategy<{ email: string }> {
    readonly name = 'test_unverified_strategy';
    private externalAuthenticationService: ExternalAuthenticationService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestUnverifiedInput {
                email: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: { email: string }): Promise<User | false | string> {
        const { email } = data;
        const user = await this.externalAuthenticationService.findUser(ctx, this.name, email);
        if (user) {
            return user;
        }
        return this.externalAuthenticationService.createCustomerAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: email,
            emailAddress: email,
            firstName: 'Unverified',
            lastName: 'Customer',
            verified: false,
        });
    }
}

export class TestAuthenticationStrategy2 implements AuthenticationStrategy<{ token: string; email: string }> {
    readonly name = 'test_strategy2';
    private externalAuthenticationService: ExternalAuthenticationService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input TestAuth2Input {
                token: String!
                email: String!
            }
        `;
    }

    async authenticate(
        ctx: RequestContext,
        data: { token: string; email: string },
    ): Promise<User | false | string> {
        const { token, email } = data;
        if (token !== VALID_AUTH_TOKEN) {
            return false;
        }
        const user = await this.externalAuthenticationService.findCustomerUser(ctx, this.name, token);
        if (user) {
            return user;
        }
        const result = await this.externalAuthenticationService.createCustomerAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: data.token,
            emailAddress: email,
            firstName: 'test',
            lastName: 'test',
            verified: true,
        });
        return result;
    }
}
