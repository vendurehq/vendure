import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { McpOauthService } from '../oauth/oauth.service';

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
}
