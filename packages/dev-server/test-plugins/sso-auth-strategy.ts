import { HttpService } from '@nestjs/axios';
import {
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    Logger,
    RequestContext,
    RoleService,
    User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

export type SSOAuthData = {
    email: string;
};

export class SSOShopAuthenticationStrategy implements AuthenticationStrategy<SSOAuthData> {
    readonly name = 'ssoShop';
    private externalAuthenticationService: ExternalAuthenticationService;
    private httpService: HttpService;
    private roleService: RoleService;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.httpService = injector.get(HttpService);
        this.roleService = injector.get(RoleService);
    }

    defineInputType(): DocumentNode {
        return gql`
            input SSOAuthInput {
                email: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: SSOAuthData): Promise<User | false> {
        if (data.email !== 'test@test.com') {
            return false;
        }
        const user = await this.externalAuthenticationService.findCustomerUser(ctx, this.name, data.email);
        if (user) {
            return user;
        }

        return this.externalAuthenticationService.createCustomerAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: data.email,
            emailAddress: data.email,
            firstName: 'test',
            lastName: 'customer',
            verified: true,
        });
    }
}
