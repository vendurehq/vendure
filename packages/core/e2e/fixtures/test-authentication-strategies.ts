import {
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    RequestContext,
    RoleService,
    User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

export const VALID_AUTH_TOKEN = 'valid-auth-token';

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
        });
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
