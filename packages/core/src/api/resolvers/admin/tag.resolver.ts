import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    DeletionResponse,
    MutationCreateTagArgs,
    MutationDeleteTagArgs,
    MutationUpdateTagArgs,
    Permission,
    QueryTagArgs,
    QueryTagsArgs,
    TagList,
} from '@vendure/common/lib/generated-types';

import { Tag } from '../../../entity/tag/tag.entity';
import { TagService } from '../../../service/services/tag.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Tag')
export class TagResolver {
    constructor(private tagService: TagService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadTag, Permission.ReadAsset)
    async tags(@Ctx() ctx: RequestContext, @Args() args: QueryTagsArgs): Promise<TagList> {
        return this.tagService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadTag, Permission.ReadAsset)
    async tag(@Ctx() ctx: RequestContext, @Args() args: QueryTagArgs): Promise<Tag | undefined> {
        return this.tagService.findOne(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreateTag)
    async createTag(@Ctx() ctx: RequestContext, @Args() args: MutationCreateTagArgs): Promise<Tag> {
        return this.tagService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateTag)
    async updateTag(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateTagArgs): Promise<Tag> {
        return this.tagService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteTag)
    async deleteTag(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteTagArgs,
    ): Promise<DeletionResponse> {
        return this.tagService.delete(ctx, args.id);
    }
}
