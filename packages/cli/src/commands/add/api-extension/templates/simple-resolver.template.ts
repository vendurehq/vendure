import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

class TemplateService {
    async exampleQueryHandler(ctx: RequestContext, id: ID) {
        return true;
    }
    async exampleMutationHandler(ctx: RequestContext, id: ID) {
        return true;
    }
}

@Resolver()
export class SimpleAdminResolver {
    constructor(private templateService: TemplateService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    async exampleQuery(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<boolean> {
        return this.templateService.exampleQueryHandler(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async exampleMutation(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<boolean> {
        return this.templateService.exampleMutationHandler(ctx, args.id);
    }
}
