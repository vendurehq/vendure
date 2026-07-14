import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationAssignProductOptionGroupsToChannelArgs,
    MutationCreateProductOptionArgs,
    MutationCreateProductOptionGroupArgs,
    MutationDeleteProductOptionArgs,
    MutationDeleteProductOptionGroupArgs,
    MutationDeleteProductOptionGroupsArgs,
    MutationRemoveProductOptionGroupsFromChannelArgs,
    MutationUpdateProductOptionArgs,
    MutationUpdateProductOptionGroupArgs,
    Permission,
    QueryProductOptionArgs,
    QueryProductOptionGroupArgs,
    QueryProductOptionGroupsArgs,
    QueryProductOptionsArgs,
    RemoveProductOptionGroupFromChannelResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ErrorResultUnion } from '../../../common/error/error-result';
import { Translated } from '../../../common/types/locale-types';
import { ProductOptionGroup } from '../../../entity/product-option-group/product-option-group.entity';
import { ProductOption } from '../../../entity/product-option/product-option.entity';
import { ProductOptionGroupService } from '../../../service/services/product-option-group.service';
import { ProductOptionService } from '../../../service/services/product-option.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class ProductOptionResolver {
    constructor(
        private productOptionGroupService: ProductOptionGroupService,
        private productOptionService: ProductOptionService,
    ) {}

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    productOptionGroups(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductOptionGroupsArgs,
        @Relations(ProductOptionGroup) relations: RelationPaths<ProductOptionGroup>,
    ): Promise<PaginatedList<Translated<ProductOptionGroup>>> {
        return this.productOptionGroupService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    productOptionGroup(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductOptionGroupArgs,
        @Relations(ProductOptionGroup) relations: RelationPaths<ProductOptionGroup>,
    ): Promise<Translated<ProductOptionGroup> | undefined> {
        return this.productOptionGroupService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateCatalog, Permission.CreateProduct)
    async createProductOptionGroup(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateProductOptionGroupArgs,
    ): Promise<Translated<ProductOptionGroup>> {
        const { input } = args;
        const group = await this.productOptionGroupService.create(ctx, input);

        if (input.options && input.options.length) {
            for (const option of input.options) {
                const newOption = await this.productOptionService.create(ctx, group, option);
                group.options.push(newOption);
            }
        }
        return group;
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async updateProductOptionGroup(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProductOptionGroupArgs,
    ): Promise<Translated<ProductOptionGroup>> {
        const { input } = args;
        return this.productOptionGroupService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProductOptionGroup(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProductOptionGroupArgs,
    ): Promise<DeletionResponse> {
        return this.productOptionGroupService.delete(ctx, args.id, args.force || false);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProductOptionGroups(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteProductOptionGroupsArgs,
    ): Promise<DeletionResponse[]> {
        const results: DeletionResponse[] = [];
        for (const id of args.ids) {
            results.push(await this.productOptionGroupService.delete(ctx, id, args.force || false));
        }
        return results;
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    productOption(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductOptionArgs,
        @Relations(ProductOption) relations: RelationPaths<ProductOption>,
    ): Promise<Translated<ProductOption> | undefined> {
        return this.productOptionService.findOne(ctx, args.id, relations);
    }

    @Query()
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    productOptions(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryProductOptionsArgs,
        @Relations(ProductOption) relations: RelationPaths<ProductOption>,
    ): Promise<PaginatedList<Translated<ProductOption>>> {
        return this.productOptionService.findAll(ctx, args.options, args.groupId, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateCatalog, Permission.CreateProduct)
    async createProductOption(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateProductOptionArgs,
    ): Promise<Translated<ProductOption>> {
        const { input } = args;
        return this.productOptionService.create(ctx, input.productOptionGroupId, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async updateProductOption(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateProductOptionArgs,
    ): Promise<Translated<ProductOption>> {
        const { input } = args;
        return this.productOptionService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async deleteProductOption(
        @Ctx() ctx: RequestContext,
        @Args() { id }: MutationDeleteProductOptionArgs,
    ): Promise<DeletionResponse> {
        return this.productOptionService.delete(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateCatalog, Permission.CreateProduct)
    async assignProductOptionGroupsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignProductOptionGroupsToChannelArgs,
    ): Promise<Array<Translated<ProductOptionGroup>>> {
        return this.productOptionGroupService.assignProductOptionGroupsToChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCatalog, Permission.DeleteProduct)
    async removeProductOptionGroupsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveProductOptionGroupsFromChannelArgs,
    ): Promise<Array<ErrorResultUnion<RemoveProductOptionGroupFromChannelResult, ProductOptionGroup>>> {
        return this.productOptionGroupService.removeProductOptionGroupsFromChannel(ctx, args.input);
    }
}
