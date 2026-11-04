import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, UserInputError } from '@vendure/core';
import { CAMPUS_JIANGHU_PERMISSION } from './permissions';
import { JianghuService, TaskInput, EventInput } from './jianghu.service';

@Resolver()
export class JianghuAdminResolver {
    constructor(private service: JianghuService) {}

    @Query()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuListProfiles(@Ctx() ctx: RequestContext, @Args() args: { cursor?: string; limit?: number }) {
        if (args.cursor != null && !/^\d+$/.test(String(args.cursor))) {
            throw new UserInputError('cursor 必须是整数');
        }
        return this.service.listProfiles(ctx, args.cursor, args.limit);
    }

    @Query()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuListTasks(@Ctx() ctx: RequestContext, @Args() args: { status?: string; limit?: number }) {
        return this.service.listTasks(ctx, args.status, args.limit);
    }

    @Query()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuListClues(@Ctx() ctx: RequestContext, @Args() args: { status?: string; limit?: number }) {
        return this.service.listClues(ctx, args.status, args.limit);
    }

    @Mutation()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuCreateTask(@Ctx() ctx: RequestContext, @Args() args: { input: TaskInput }) {
        return this.service.createTask(ctx, args.input);
    }

    @Mutation()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuAuditIntel(@Ctx() ctx: RequestContext, @Args() args: { id: string; approve: boolean }) {
        return this.service.auditIntel(ctx, args.id, args.approve);
    }

    @Mutation()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuPenalize(@Ctx() ctx: RequestContext, @Args() args: { customerId: string; level: string }) {
        return this.service.penalize(ctx, args.customerId, args.level as any);
    }

    @Mutation()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuCreateEvent(@Ctx() ctx: RequestContext, @Args() args: { input: EventInput }) {
        return this.service.createEvent(ctx, args.input);
    }

    @Mutation()
    @Allow(CAMPUS_JIANGHU_PERMISSION.Permission)
    jianghuAuditClue(@Ctx() ctx: RequestContext, @Args() args: { id: string; approve: boolean }) {
        return this.service.auditClue(ctx, args.id, args.approve);
    }
}
