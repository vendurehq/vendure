import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    Asset,
    AssetType,
    Country,
    Ctx,
    PluginCommonModule,
    Product,
    ProductAsset,
    RequestContext,
    Transaction,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
export class SlowMutationResolver {
    constructor(private connection: TransactionalConnection) {}

    /**
     * A mutation which simulates some slow DB operations occurring within a transaction.
     */
    @Transaction()
    @Mutation()
    async slowMutation(@Ctx() ctx: RequestContext, @Args() args: { delay: number }) {
        const delay = Math.round(args.delay / 2);
        const country = await this.connection.getRepository(ctx, Country).findOneOrFail({
            where: {
                code: 'AT',
            },
        });
        country.enabled = false;
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.connection.getRepository(ctx, Country).save(country);
        country.enabled = true;
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.connection.getRepository(ctx, Country).save(country);
        return true;
    }

    /**
     * This mutation attempts to cause a deadlock
     */
    @Transaction()
    @Mutation()
    async attemptDeadlock(@Ctx() ctx: RequestContext) {
        const product = await this.connection.getRepository(ctx, Product).findOneOrFail({ where: { id: 1 } });
        const asset = await this.connection.getRepository(ctx, Asset).save(
            new Asset({
                name: 'test',
                type: AssetType.BINARY,
                mimeType: 'test/test',
                fileSize: 1,
                source: '',
                preview: '',
            }),
        );
        await new Promise(resolve => setTimeout(resolve, 100));
        const productAsset = await this.connection.getRepository(ctx, ProductAsset).save(
            new ProductAsset({
                assetId: asset.id,
                productId: product.id,
                position: 0,
            }),
        );
        await this.connection.getRepository(ctx, Product).update(product.id, { enabled: false });
        return true;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        resolvers: [SlowMutationResolver],
        schema: gql`
            extend type Mutation {
                slowMutation(delay: Int!): Boolean!
                attemptDeadlock: Boolean!
            }
        `,
    },
})
export class SlowMutationPlugin {}
