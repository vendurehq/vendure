/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Asset,
    Ctx,
    EntityHydrator,
    ID,
    PluginCommonModule,
    Product,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
class TestResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private connection: TransactionalConnection,
        private entityHydrator: EntityHydrator,
    ) {}

    @Query()
    async hydrateTest(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: args.id },
            relations: ['featuredAsset'],
        });
        await this.entityHydrator.hydrate(ctx, product!, {
            relations: ['facetValues.facet', 'customFields.thumb'],
        });
        return product;
    }
}

// A plugin to explore solutions to https://github.com/vendurehq/vendure/issues/1103
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Query {
                hydrateTest(id: ID!): JSON
            }
        `,
        resolvers: [TestResolver],
    },
    configuration: config => {
        config.customFields.Product.push({
            name: 'thumb',
            type: 'relation',
            entity: Asset,
        });
        return config;
    },
})
export class EntityHydratePlugin {}
