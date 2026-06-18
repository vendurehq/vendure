import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { DeletionResponse, Permission } from '@vendure/common/lib/generated-types';
import {
    Allow,
    Ctx,
    ID,
    ListQueryOptions,
    PaginatedList,
    RelationPaths,
    Relations,
    RequestContext,
    Transaction,
} from '@vendure/core';
import { productBundlePermission } from '../constants';
import { ProductBundle } from '../entities/product-bundle.entity';
import { ProductBundleItemService } from '../services/product-bundle-item.service';
import { ProductBundleService } from '../services/product-bundle.service';
import {
    CreateProductBundleInput,
    CreateProductBundleItemInput,
    UpdateProductBundleInput,
    UpdateProductBundleItemInput,
} from '../types';

@Resolver()
export class ProductBundleAdminResolver {
    constructor(
        private productBundleService: ProductBundleService,
        private productBundleItemService: ProductBundleItemService,
    ) {}

    @Query()
    @Allow(productBundlePermission.Read)
    async productBundle(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
        @Relations(ProductBundle) relations: RelationPaths<ProductBundle>,
    ): Promise<ProductBundle | null> {
        return this.productBundleService.findOne(ctx, args.id, relations);
    }

    @Query()
    @Allow(productBundlePermission.Read)
    async productBundles(
        @Ctx() ctx: RequestContext,
        @Args() args: { options: ListQueryOptions<ProductBundle> },
        @Relations(ProductBundle) relations: RelationPaths<ProductBundle>,
    ): Promise<PaginatedList<ProductBundle>> {
        return this.productBundleService.findAll(ctx, args.options || undefined, relations);
    }

    @Mutation()
    @Transaction()
    @Allow(productBundlePermission.Create)
    async createProductBundle(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateProductBundleInput },
    ): Promise<ProductBundle> {
        return this.productBundleService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(productBundlePermission.Update)
    async updateProductBundle(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateProductBundleInput },
    ): Promise<ProductBundle> {
        return this.productBundleService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(productBundlePermission.Delete)
    async deleteProductBundle(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
    ): Promise<DeletionResponse> {
        return this.productBundleService.delete(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(productBundlePermission.Create)
    createProductBundleItem(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateProductBundleItemInput },
    ) {
        return this.productBundleItemService.createProductBundleItem(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(productBundlePermission.Update)
    updateProductBundleItem(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateProductBundleItemInput },
    ) {
        return this.productBundleItemService.updateProductBundleItem(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(productBundlePermission.Delete)
    deleteProductBundleItem(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.productBundleItemService.delete(ctx, args.id);
    }
}
