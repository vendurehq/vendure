import { Args, Resolver, Subscription } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    Permission,
    PluginCommonModule,
    ProductService,
    ProductVariantService,
    RequestContext,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';
import { firstValueFrom, Subject } from 'rxjs';

/**
 * Makes each subscription which streams updates send its next result.
 */
export const triggerUpdate = new Subject<void>();

const requestContextType = gql`
    type TestRequestContext {
        channelToken: String!
        languageCode: String!
        activeUserId: ID
        sessionId: ID
        cookie: String
    }
`;

function toTestRequestContext(ctx: RequestContext) {
    return {
        channelToken: ctx.channel.token,
        languageCode: ctx.languageCode,
        activeUserId: ctx.activeUserId,
        sessionId: ctx.session?.id,
        cookie: ctx.req?.headers.cookie,
    };
}

@Resolver()
export class ShopRequestContextResolver {
    @Subscription()
    @Allow(Permission.Public)
    async *requestContext(@Ctx() ctx: RequestContext) {
        yield { requestContext: toTestRequestContext(ctx) };
    }

    @Subscription()
    @Allow(Permission.Owner)
    async *ownerRequestContext(@Ctx() ctx: RequestContext) {
        yield { ownerRequestContext: toTestRequestContext(ctx) };
    }
}

@Resolver()
export class AdminRequestContextResolver {
    @Subscription()
    @Allow(Permission.ReadCatalog)
    async *requestContext(@Ctx() ctx: RequestContext) {
        yield { requestContext: toTestRequestContext(ctx) };
    }

    @Subscription()
    @Allow(Permission.ReadCatalog)
    async *requestContextUpdates(@Ctx() ctx: RequestContext) {
        const update = firstValueFrom(triggerUpdate);
        yield { requestContextUpdates: toTestRequestContext(ctx) };
        await update;
        yield { requestContextUpdates: toTestRequestContext(ctx) };
    }

    // Each result fails, since the field is not nullable
    @Subscription()
    @Allow(Permission.ReadCatalog)
    async *failingUpdates() {
        const update = firstValueFrom(triggerUpdate);
        yield { failingUpdates: null };
        await update;
        yield { failingUpdates: null };
    }
}

@Resolver()
export class ProductSubscriptionResolver {
    constructor(private productService: ProductService) {}

    @Subscription()
    @Allow(Permission.Public)
    async *product(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        yield { product: await this.productService.findOne(ctx, args.id) };
    }
}

@Resolver()
export class ProductVariantSubscriptionResolver {
    constructor(private productVariantService: ProductVariantService) {}

    @Subscription()
    @Allow(Permission.ReadCatalog)
    async *productVariantUpdates(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        const update = firstValueFrom(triggerUpdate);
        yield { productVariantUpdates: await this.productVariantService.findOne(ctx, args.id) };
        await update;
        yield { productVariantUpdates: await this.productVariantService.findOne(ctx, args.id) };
    }
}

@VendurePlugin({
    shopApiExtensions: {
        resolvers: [ShopRequestContextResolver],
        schema: gql`
            ${requestContextType}
            extend type Subscription {
                requestContext: TestRequestContext!
                ownerRequestContext: TestRequestContext!
            }
        `,
    },
    adminApiExtensions: {
        resolvers: [AdminRequestContextResolver],
        schema: gql`
            ${requestContextType}
            extend type Subscription {
                requestContext: TestRequestContext!
                requestContextUpdates: TestRequestContext!
                failingUpdates: TestRequestContext!
            }
        `,
    },
})
export class RequestContextSubscriptionPlugin {}

@VendurePlugin({
    imports: [PluginCommonModule],
    shopApiExtensions: {
        resolvers: [ProductSubscriptionResolver],
        schema: gql`
            extend type Subscription {
                product(id: ID!): Product
            }
        `,
    },
    adminApiExtensions: {
        resolvers: [ProductVariantSubscriptionResolver],
        schema: gql`
            extend type Subscription {
                productVariantUpdates(id: ID!): ProductVariant
            }
        `,
    },
})
export class ProductSubscriptionPlugin {}
