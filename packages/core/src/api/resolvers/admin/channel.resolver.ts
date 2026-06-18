import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    CreateChannelResult,
    DeletionResponse,
    MutationCreateChannelArgs,
    MutationDeleteChannelArgs,
    MutationDeleteChannelsArgs,
    MutationUpdateChannelArgs,
    Permission,
    QueryChannelArgs,
    QueryChannelsArgs,
    UpdateChannelResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ErrorResultUnion, isGraphQlErrorResult } from '../../../common/error/error-result';
import { Channel } from '../../../entity/channel/channel.entity';
import { ChannelService } from '../../../service/services/channel.service';
import { RoleService } from '../../../service/services/role.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('Channel')
export class ChannelResolver {
    constructor(
        private channelService: ChannelService,
        private roleService: RoleService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadChannel)
    async channels(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryChannelsArgs,
    ): Promise<PaginatedList<Channel>> {
        return this.channelService.findAll(ctx, args.options || undefined);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadChannel)
    async channel(@Ctx() ctx: RequestContext, @Args() args: QueryChannelArgs): Promise<Channel | undefined> {
        return this.channelService.findOne(ctx, args.id);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async activeChannel(@Ctx() ctx: RequestContext): Promise<Channel> {
        return ctx.channel;
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.CreateChannel)
    async createChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateChannelArgs,
    ): Promise<ErrorResultUnion<CreateChannelResult, Channel>> {
        const result = await this.channelService.create(ctx, args.input);
        if (isGraphQlErrorResult(result)) {
            return result;
        }
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const customerRole = await this.roleService.getCustomerRole(ctx);
        await this.roleService.assignRoleToChannel(ctx, superAdminRole.id, result.id);
        await this.roleService.assignRoleToChannel(ctx, customerRole.id, result.id);
        return result;
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.UpdateChannel)
    async updateChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateChannelArgs,
    ): Promise<ErrorResultUnion<UpdateChannelResult, Channel>> {
        return this.channelService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.DeleteChannel)
    async deleteChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteChannelArgs,
    ): Promise<DeletionResponse> {
        return this.channelService.delete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.SuperAdmin, Permission.DeleteChannel)
    async deleteChannels(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteChannelsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.channelService.delete(ctx, id)));
    }
}
