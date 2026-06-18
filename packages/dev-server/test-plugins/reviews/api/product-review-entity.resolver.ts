import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    Product,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    translateDeep,
} from '@vendure/core';

import { ProductReview } from '../entities/product-review.entity';

@Resolver('ProductReview')
export class ProductReviewEntityResolver {
    constructor(private connection: TransactionalConnection) {}

    @ResolveField()
    async product(@Parent() review: ProductReview, @Ctx() ctx: RequestContext) {
        let product: Product | null = review.product;
        if (!product) {
            const reviewWithProduct = await this.connection.getRepository(ctx, ProductReview).findOne({
                where: { id: review.id },
                relations: {
                    product: true,
                },
            });
            if (reviewWithProduct) {
                product = reviewWithProduct.product;
            }
        }
        if (product) {
            return translateDeep(product, ctx.languageCode);
        }
    }

    @ResolveField()
    async productVariant(@Parent() review: ProductReview, @Ctx() ctx: RequestContext) {
        let productVariant: ProductVariant | null = review.productVariant;
        if (!productVariant) {
            const reviewWithProductVariant = await this.connection.getRepository(ctx, ProductReview).findOne({
                where: { id: review.id },
                relations: {
                    productVariant: true,
                },
            });
            if (reviewWithProductVariant) {
                productVariant = reviewWithProductVariant.productVariant;
            }
        }
        if (productVariant) {
            return translateDeep(productVariant, ctx.languageCode);
        }
    }
}
