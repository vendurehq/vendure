import { DeletionResponse, MutationCreateTagArgs, MutationDeleteTagArgs, MutationUpdateTagArgs, QueryTagArgs, QueryTagsArgs, TagList } from '@vendure/common/lib/generated-types';
import { Tag } from '../../../entity/tag/tag.entity';
import { TagService } from '../../../service/services/tag.service';
import { RequestContext } from '../../common/request-context';
export declare class TagResolver {
    private tagService;
    constructor(tagService: TagService);
    tags(ctx: RequestContext, args: QueryTagsArgs): Promise<TagList>;
    tag(ctx: RequestContext, args: QueryTagArgs): Promise<Tag>;
    createTag(ctx: RequestContext, args: MutationCreateTagArgs): Promise<Tag>;
    updateTag(ctx: RequestContext, args: MutationUpdateTagArgs): Promise<Tag>;
    deleteTag(ctx: RequestContext, args: MutationDeleteTagArgs): Promise<DeletionResponse>;
}
