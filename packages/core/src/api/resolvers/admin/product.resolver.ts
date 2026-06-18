import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationAddOptionGroupToProductArgs,
    MutationAssignProductsToChannelArgs,
    MutationAssignProductVariantsToChannelArgs,
    MutationCreateProductArgs,
    MutationCreateProductVariantsArgs,
    MutationDeleteProductArgs,
    MutationDeleteProductsArgs,
    MutationDeleteProductVariantArgs,
    MutationDeleteProductVariantsArgs,
    MutationRemoveOptionGroupFromProductArgs,
    MutationRemoveProductsFromChannelArgs,
    MutationRemoveProductVariantsFromChannelArgs,
    MutationUpdateProductArgs,
    MutationUpdateProductsArgs,
    MutationUpdateProductVariantArgs,
    MutationUpdateProductVariantsArgs,
    Permission,
    QueryProductArgs,
    QueryProductsArgs,
    QueryProductVariantArgs,
    QueryProductVariantsArgs,
    RemoveOptionGroupFromProductResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ErrorResultUnion } from '../../../common/error/error-result';
import { UserInputError } from '../../../common/error/errors';
import { Translated } from '../../../common/types/locale-types';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';
import { FacetValueService } from '../../../service/services/facet-value.service';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { ProductService } from '../../../service/services/product.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class ProductResolver {
    constructor(
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private facetValueService: FacetValueService,
    ) {}

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async products(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductsArgs,
        @Relations({ entity: Product, omit: ['variants', 'assets'] }) relations: RelationPaths<Product>,
    ): Promise<PaginatedList<Translated<Product>>> {
        return this.productService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async product(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductArgs,
        @Relations({ entity: Product, omit: ['variants', 'assets'] }) relations: RelationPaths<Product>,
    ): Promise<Translated<Product> | undefined> {
        if (args.id) {
            const product = await this.productService.findOne(ctx, args.id, relations);
            if (args.slug && product && product.slug !== args.slug) {
                throw new UserInputError('error.product-id-slug-mismatch');
            }
            return product;
        } else if (args.slug) {
            return this.productService.findOneBySlug(ctx, args.slug, relations);
        } else {
            throw new UserInputError('error.product-id-or-slug-must-be-provided');
        }
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async productVariants(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductVariantsArgs,
        @Relations({ entity: ProductVariant, omit: ['assets'] }) relations: RelationPaths<ProductVariant>,
    ): Promise<PaginatedList<Translated<ProductVariant>>> {
        if (args.productId) {
            return this.productVariantService.getVariantsByProductId(
                ctx,
                args.productId,
                args.options || undefined,
                relations,
            );
        }

        return this.productVariantService.findAll(ctx, args.options || undefined);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async productVariant(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductVariantArgs,
    ): Promise<Translated<ProductVariant> | undefined> {
        return this.productVariantService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateCatalog, Permission.CreateProduct)
    async createProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateProductArgs,
    ): Promise<Translated<Product>> {
        const { input } = args;
        return this.productService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async updateProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProductArgs,
    ): Promise<Translated<Product>> {
        const { input } = args;
        return await this.productService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async updateProducts(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProductsArgs,
    ): Promise<Array<Translated<Product>>> {
        return await Promise.all(args.input.map(i => this.productService.update(ctx, i)));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProductArgs,
    ): Promise<DeletionResponse> {
        return this.productService.softDelete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProducts(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProductsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.productService.softDelete(ctx, id)));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async addOptionGroupToProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAddOptionGroupToProductArgs,
    ): Promise<Translated<Product>> {
        const { productId, optionGroupId } = args;
        return this.productService.addOptionGroupToProduct(ctx, productId, optionGroupId);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async removeOptionGroupFromProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveOptionGroupFromProductArgs,
    ): Promise<ErrorResultUnion<RemoveOptionGroupFromProductResult, Translated<Product>>> {
        const { productId, optionGroupId, force } = args;
        return this.productService.removeOptionGroupFromProduct(ctx, productId, optionGroupId, force);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async createProductVariants(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateProductVariantsArgs,
    ): Promise<Array<Translated<ProductVariant>>> {
        const { input } = args;
        return this.productVariantService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async updateProductVariant(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProductVariantArgs,
    ): Promise<Translated<ProductVariant>> {
        const { input } = args;
        return this.productVariantService.update(ctx, [input]).then(variants => variants[0]);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async updateProductVariants(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProductVariantsArgs,
    ): Promise<Array<Translated<ProductVariant>>> {
        const { input } = args;
        return this.productVariantService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProductVariant(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProductVariantArgs,
    ): Promise<DeletionResponse> {
        return this.productVariantService.softDelete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProductVariants(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProductVariantsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.productVariantService.softDelete(ctx, id)));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async assignProductsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignProductsToChannelArgs,
    ): Promise<Array<Translated<Product>>> {
        return this.productService.assignProductsToChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async removeProductsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveProductsFromChannelArgs,
    ): Promise<Array<Translated<Product>>> {
        return this.productService.removeProductsFromChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async assignProductVariantsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignProductVariantsToChannelArgs,
    ): Promise<Array<Translated<ProductVariant>>> {
        return this.productVariantService.assignProductVariantsToChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async removeProductVariantsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveProductVariantsFromChannelArgs,
    ): Promise<Array<Translated<ProductVariant>>> {
        return this.productVariantService.removeProductVariantsFromChannel(ctx, args.input);
    }
}
