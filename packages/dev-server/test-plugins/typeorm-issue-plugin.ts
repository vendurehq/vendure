import { Args, Query, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    ListQueryBuilder,
    PluginCommonModule,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    translateDeep,
    VendurePlugin,
} from '@vendure/core';
import { gql } from 'graphql-tag';

// Testing this issue https://github.com/typeorm/typeorm/issues/7707
@Resolver()
export class TestResolver {
    constructor(private connection: TransactionalConnection, private listQueryBuilder: ListQueryBuilder) {}

    @Query()
    test(@Ctx() ctx: RequestContext, @Args() args: any) {
        const relations = [
            'options',
            'facetValues',
            'facetValues.facet',
            'taxCategory',
            'assets',
            'featuredAsset',
        ];

        return this.listQueryBuilder
            .build(
                ProductVariant,
                {},
                {
                    relations,
                    orderBy: { id: 'ASC' },
                    where: { deletedAt: null },
                    ctx,
                },
            )
            .innerJoinAndSelect('productvariant.channels', 'channel', 'channel.id = :channelId', {
                channelId: ctx.channelId,
            })
            .innerJoinAndSelect('productvariant.product', 'product', 'product.id = :productId', {
                id: args.id,
            })
            .getManyAndCount()
            .then(async ([variants, totalItems]) => {
                const items = await Promise.all(
                    variants.map(async variant => {
                        return translateDeep(variant, ctx.languageCode, [
                            'options',
                            'facetValues',
                            ['facetValues', 'facet'],
                        ]);
                    }),
                );

                return {
                    items,
                    totalItems,
                };
            });
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    shopApiExtensions: {
        schema: gql`
            extend type Query {
                test(id: ID!): [ProductVariant!]!
            }
        `,
        resolvers: [TestResolver],
    },
})
export class TypeormIssuePlugin {}
