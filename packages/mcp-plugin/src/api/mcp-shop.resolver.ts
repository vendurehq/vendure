import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { McpOauthService } from '../oauth/oauth.service';

/** One of the signed-in customer's own active MCP OAuth grants, summarised for a connected-assistants page. */
interface McpCustomerOauthGrantInfo {
    id: ID;
    createdAt: Date;
    oauthClientName: string | null;
    lastActivityAt: Date;
    expiresAt: Date;
}

@Resolver()
export class McpShopResolver {
    constructor(private oauthService: McpOauthService) {}

    @Mutation()
    @Allow(Permission.Public)
    async authorizeMcpClient(
        @Ctx() ctx: RequestContext,
        @Args() args: { requestToken: string; approved: boolean },
    ): Promise<{ redirectUrl: string }> {
        return this.oauthService.approveCustomerRequest(ctx, args.requestToken, args.approved);
    }

    @Query()
    @Allow(Permission.Owner)
    async activeMcpClientGrants(@Ctx() ctx: RequestContext): Promise<McpCustomerOauthGrantInfo[]> {
        const grants = await this.oauthService.listCustomerGrants(ctx);
        return grants.map(grant => ({
            id: grant.id,
            createdAt: grant.createdAt,
            oauthClientName: grant.oauthClient?.clientName ?? null,
            lastActivityAt: grant.lastActivityAt,
            expiresAt: grant.expiresAt,
        }));
    }

    @Mutation()
    @Allow(Permission.Owner)
    async revokeMcpClientGrant(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<boolean> {
        return this.oauthService.revokeCustomerGrant(ctx, args.id);
    }
}
