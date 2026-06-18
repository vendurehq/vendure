import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { DeletionResponse, Permission } from '@vendure/common/lib/generated-types';
import { CustomFieldsObject } from '@vendure/common/lib/shared-types';
import {
    Allow,
    Ctx,
    PaginatedList,
    RequestContext,
    Transaction,
    Relations,
    VendureEntity,
    ID,
    TranslationInput,
    ListQueryOptions,
    RelationPaths,
} from '@vendure/core';

class TemplateEntity extends VendureEntity {
    constructor() {
        super();
    }
}

class TemplateService {
    findAll(ctx: RequestContext, options?: any, relations?: any): Promise<PaginatedList<TemplateEntity>> {
        throw new Error('Method not implemented.');
    }

    findOne(ctx: RequestContext, id: ID, relations?: any): Promise<TemplateEntity | null> {
        throw new Error('Method not implemented.');
    }

    create(ctx: RequestContext, input: any): Promise<TemplateEntity> {
        throw new Error('Method not implemented.');
    }

    update(ctx: RequestContext, input: any): Promise<TemplateEntity> {
        throw new Error('Method not implemented.');
    }

    delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        throw new Error('Method not implemented.');
    }
}

// These can be replaced by generated types if you set up code generation
interface CreateEntityInput {
    // Define the input fields here
    customFields?: CustomFieldsObject;
    translations: Array<TranslationInput<TemplateEntity>>;
}
interface UpdateEntityInput {
    id: ID;
    // Define the input fields here
    customFields?: CustomFieldsObject;
    translations: Array<TranslationInput<TemplateEntity>>;
}

@Resolver()
export class EntityAdminResolver {
    constructor(private templateService: TemplateService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    async entity(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
        @Relations(TemplateEntity) relations: RelationPaths<TemplateEntity>,
    ): Promise<TemplateEntity | null> {
        return this.templateService.findOne(ctx, args.id, relations);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async entities(
        @Ctx() ctx: RequestContext,
        @Args() args: { options: ListQueryOptions<TemplateEntity> },
        @Relations(TemplateEntity) relations: RelationPaths<TemplateEntity>,
    ): Promise<PaginatedList<TemplateEntity>> {
        return this.templateService.findAll(ctx, args.options || undefined, relations);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async createEntity(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateEntityInput },
    ): Promise<TemplateEntity> {
        return this.templateService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async updateEntity(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateEntityInput },
    ): Promise<TemplateEntity> {
        return this.templateService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async deleteEntity(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<DeletionResponse> {
        return this.templateService.delete(ctx, args.id);
    }
}
