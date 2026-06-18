import { Mutation, Resolver } from '@nestjs/graphql';
import {
    CollectionService,
    Ctx,
    Logger,
    PluginCommonModule,
    ProductVariantService,
    RequestContext,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

@Resolver()
class FillBufferResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private collectionService: CollectionService,
    ) {}

    @Mutation()
    async fillBuffer(@Ctx() ctx: RequestContext) {
        const { items: variants } = await this.productVariantService.findAll(ctx);
        const { items: collections } = await this.collectionService.findAll(ctx);
        const limit = 2000;
        for (let i = 0; i < limit; i++) {
            const variant = variants[i % variants.length];
            await this.productVariantService.update(ctx, [
                {
                    id: variant.id,
                    enabled: !variant.enabled,
                },
            ]);
            const collection = collections[i % collections.length];
            await this.collectionService.update(ctx, {
                id: collection.id,
                isPrivate: !collection.isPrivate,
            });
            if (i % 100 === 0) {
                Logger.info(`Updated ${i} / ${limit} items...`);
            }
        }
        Logger.info(`Done!`);
        return true;
    }
}

/**
 * Plugin to create a lot of buffered jobs to test help investigate and fix
 * issue https://github.com/vendurehq/vendure/issues/1433
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend type Mutation {
                fillBuffer: Boolean!
            }
        `,
        resolvers: [FillBufferResolver],
    },
})
export class FillBufferPlugin {}
