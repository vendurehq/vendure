import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    ListQueryOptions,
    PaginatedList,
    Permission,
    RequestContext,
    Transaction,
} from '@vendure/core';
import { ShippingTemplateService } from './shipping-template.service';
import { ShippingTemplatePermissions } from './shipping-template-permissions';
import { ShippingTemplate } from './shipping-template.entity';

@Resolver()
export class ShippingTemplateAdminResolver {
    constructor(private shippingTemplateService: ShippingTemplateService) {}

    @Query()
    @Allow(ShippingTemplatePermissions.ReadShippingTemplate as Permission)
    async shippingTemplates(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<ShippingTemplate>,
    ): Promise<PaginatedList<ShippingTemplate>> {
        return this.shippingTemplateService.findAll(ctx, options);
    }

    @Query()
    @Allow(ShippingTemplatePermissions.ReadShippingTemplate as Permission)
    async shippingTemplate(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<ShippingTemplate | undefined> {
        return this.shippingTemplateService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(ShippingTemplatePermissions.CreateShippingTemplate as Permission)
    async createShippingTemplate(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<ShippingTemplate> {
        return this.shippingTemplateService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(ShippingTemplatePermissions.UpdateShippingTemplate as Permission)
    async updateShippingTemplate(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<ShippingTemplate> {
        return this.shippingTemplateService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(ShippingTemplatePermissions.DeleteShippingTemplate as Permission)
    async deleteShippingTemplate(@Ctx() ctx: RequestContext, @Args('id') id: ID): Promise<boolean> {
        await this.shippingTemplateService.delete(ctx, id);
        return true;
    }

    @Mutation()
    @Transaction()
    @Allow(ShippingTemplatePermissions.CreateShippingMethodFromTemplate as Permission)
    async createShippingMethodFromTemplate(
        @Ctx() ctx: RequestContext,
        @Args('templateId') templateId: ID,
        @Args('name', { nullable: true }) name?: string,
        @Args('code', { nullable: true }) code?: string,
    ): Promise<any> {
        return this.shippingTemplateService.createShippingMethodFromTemplate(ctx, templateId, name, code);
    }

    @Mutation()
    @Transaction()
    @Allow(ShippingTemplatePermissions.CreateShippingMethodFromTemplate as Permission)
    async updateShippingMethodShippingPrice(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('shippingPrice') shippingPrice: number,
    ): Promise<any> {
        return this.shippingTemplateService.updateShippingMethodShippingPrice(ctx, id, shippingPrice);
    }
}
