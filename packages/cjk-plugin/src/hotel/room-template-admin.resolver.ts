import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    Permission,
    RequestContext,
    Transaction,
} from '@vendure/core';
import { RoomTemplateService } from './room-template.service';
import { RoomTemplate } from './room-template.entity';

@Resolver()
export class RoomTemplateAdminResolver {
    constructor(private roomTemplateService: RoomTemplateService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    async roomTemplates(): Promise<RoomTemplate[]> {
        return this.roomTemplateService.findAll();
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async roomTemplate(@Args('id') id: ID): Promise<RoomTemplate | undefined> {
        return this.roomTemplateService.findOne(id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async createRoomTemplate(@Args('input') input: any): Promise<RoomTemplate> {
        return this.roomTemplateService.create(input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async updateRoomTemplate(@Args('id') id: ID, @Args('input') input: any): Promise<RoomTemplate> {
        return this.roomTemplateService.update(id, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async deleteRoomTemplate(@Args('id') id: ID): Promise<boolean> {
        await this.roomTemplateService.delete(id);
        return true;
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async applyRoomTemplate(
        @Ctx() ctx: RequestContext,
        @Args('variantId') variantId: ID,
        @Args('templateId') templateId: ID,
    ): Promise<boolean> {
        return this.roomTemplateService.applyToVariant(ctx, variantId, templateId);
    }
}
