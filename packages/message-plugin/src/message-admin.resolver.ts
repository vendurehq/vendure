import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';
import { DeliveryPermissions } from '@vendure/delivery-plugin';

import { MessageJob } from './message-job';
import { MessageService } from './message.service';

@Resolver()
export class MessageAdminResolver {
    constructor(
        private messageService: MessageService,
        private messageJob: MessageJob,
    ) {}

    @Query()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async messages(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: any = { take: 20 },
    ) {
        return this.messageService.findAll(ctx, options);
    }

    @Query()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async message(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.messageService.findOne(ctx, id);
    }

    @Query()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async messageDeliveryStats(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.messageService.getDeliveryStats(ctx, id);
    }

    @Mutation()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async createMessage(@Ctx() ctx: RequestContext, @Args('input') input: any) {
        return this.messageService.create(ctx, input);
    }

    @Mutation()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async updateMessage(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('input') input: any) {
        return this.messageService.update(ctx, id, input);
    }

    @Mutation()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async deleteMessage(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.messageService.delete(ctx, id);
    }

    @Mutation()
    @Allow(DeliveryPermissions.ManageMessage as any)
    async sendMessage(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        const msg = await this.messageService.sendMessage(ctx, id);
        await this.messageJob.addSendJob(msg.id, ctx.channelId);
        return msg;
    }
}
