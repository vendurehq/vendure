import { HttpService } from '@nestjs/axios';
import {
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    Logger,
    RequestContext,
    Role,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

export type KeycloakAuthData = {
    token: string;
};

export type OpenIdUserInfo = {
    name: string;
    sub: string;
    email?: string;
    email_verified: boolean;
    preferred_username: string;
    given_name?: string;
    family_name?: string;
};

export class KeycloakAuthenticationStrategy implements AuthenticationStrategy<KeycloakAuthData> {
    readonly name = 'keycloak';
    private externalAuthenticationService: ExternalAuthenticationService;
    private httpService: HttpService;
    private connection: TransactionalConnection;
    private bearerToken: string;

    init(injector: Injector) {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.httpService = injector.get(HttpService);
        this.connection = injector.get(TransactionalConnection);
    }

    defineInputType(): DocumentNode {
        return gql`
            input KeycloakAuthInput {
                token: String!
            }
        `;
    }

    async authenticate(ctx: RequestContext, data: KeycloakAuthData): Promise<User | false> {
        let userInfo: OpenIdUserInfo;
        this.bearerToken = data.token;
        try {
            const response = await this.httpService
                .get('http://localhost:9000/realms/myrealm/protocol/openid-connect/userinfo', {
                    headers: {
                        Authorization: `Bearer ${this.bearerToken}`,
                    },
                })
                .toPromise();
            userInfo = response?.data;
        } catch (e: any) {
            Logger.error(e);
            return false;
        }

        if (!userInfo) {
            return false;
        }
        const user = await this.externalAuthenticationService.findAdministratorUser(
            ctx,
            this.name,
            userInfo.sub,
        );
        if (user) {
            return user;
        }

        const merchantRole = await this.connection.getRepository(ctx, Role).findOne({
            where: { code: 'merchant' },
        });

        if (!merchantRole) {
            Logger.error(`Could not find "merchant" role`);
            return false;
        }

        return this.externalAuthenticationService.createAdministratorAndUser(ctx, {
            strategy: this.name,
            externalIdentifier: userInfo.sub,
            identifier: userInfo.preferred_username,
            emailAddress: userInfo.email,
            firstName: userInfo.given_name ?? userInfo.preferred_username,
            lastName: userInfo.family_name ?? userInfo.preferred_username,
            roles: [merchantRole],
        });
    }
}
