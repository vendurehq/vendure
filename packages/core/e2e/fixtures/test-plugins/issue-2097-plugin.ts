import { Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
class TestResolver {
    @Query()
    async publicThing(@Ctx() ctx: RequestContext) {
        return true;
    }

    @Query()
    @Allow(Permission.Owner)
    async ownerProtectedThing(@Ctx() ctx: RequestContext) {
        if (ctx.authorizedAsOwnerOnly) {
            return true;
        } else {
            return false;
        }
    }
}

@VendurePlugin({
    shopApiExtensions: {
        schema: gql`
            extend type Query {
                publicThing: Boolean!
                ownerProtectedThing: Boolean!
            }
        `,
        resolvers: [TestResolver],
    },
})
export class Issue2097Plugin {}
