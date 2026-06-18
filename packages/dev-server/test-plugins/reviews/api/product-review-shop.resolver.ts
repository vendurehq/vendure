import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    Customer,
    ListQueryBuilder,
    Product,
    ProductVariant,
    RequestContext,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';

import { ProductReview } from '../entities/product-review.entity';
import { MutationSubmitProductReviewArgs, MutationVoteOnReviewArgs } from '../generated-shop-types';

@Resolver()
export class ProductReviewShopResolver {
    constructor(private connection: TransactionalConnection, private listQueryBuilder: ListQueryBuilder) {}

    @Transaction()
    @Mutation()
    async submitProductReview(
        @Ctx() ctx: RequestContext,
        @Args() { input }: MutationSubmitProductReviewArgs,
    ) {
        const review = new ProductReview(input);
        const product = await this.connection.getEntityOrThrow(ctx, Product, input.productId);
        review.product = product;
        review.state = 'new';
        if (input.variantId) {
            const variant = await this.connection.getEntityOrThrow(ctx, ProductVariant, input.variantId);
            review.productVariant = variant;
        }
        if (input.customerId) {
            const customer = await this.connection.getEntityOrThrow(ctx, Customer, input.customerId);
            review.author = customer;
        }
        return this.connection.getRepository(ctx, ProductReview).save(review);
    }

    @Transaction()
    @Mutation()
    async voteOnReview(@Ctx() ctx: RequestContext, @Args() { id, vote }: MutationVoteOnReviewArgs) {
        const review = await this.connection.getEntityOrThrow(ctx, ProductReview, id, {
            relations: ['product'],
            where: {
                state: 'approved',
            },
        });
        if (vote) {
            review.upvotes++;
        } else {
            review.downvotes++;
        }
        return this.connection.getRepository(ctx, ProductReview).save(review);
    }
}
