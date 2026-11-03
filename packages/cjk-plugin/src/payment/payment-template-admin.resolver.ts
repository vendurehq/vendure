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
import { PaymentTemplateService } from './payment-template.service';
import { PaymentTemplatePermissions } from './payment-template-permissions';
import { PaymentTemplate } from './payment-template.entity';

@Resolver()
export class PaymentTemplateAdminResolver {
    constructor(private paymentTemplateService: PaymentTemplateService) {}

    @Query()
    @Allow(PaymentTemplatePermissions.ReadPaymentTemplate as Permission)
    async paymentTemplates(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<PaymentTemplate>,
    ): Promise<PaginatedList<PaymentTemplate>> {
        return this.paymentTemplateService.findAll(ctx, options);
    }

    @Query()
    @Allow(PaymentTemplatePermissions.ReadPaymentTemplate as Permission)
    async paymentTemplate(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<PaymentTemplate | undefined> {
        return this.paymentTemplateService.findOne(ctx, id);
    }

    @Mutation()
    @Transaction()
    @Allow(PaymentTemplatePermissions.CreatePaymentTemplate as Permission)
    async createPaymentTemplate(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<PaymentTemplate> {
        return this.paymentTemplateService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(PaymentTemplatePermissions.UpdatePaymentTemplate as Permission)
    async updatePaymentTemplate(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<PaymentTemplate> {
        return this.paymentTemplateService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(PaymentTemplatePermissions.DeletePaymentTemplate as Permission)
    async deletePaymentTemplate(@Ctx() ctx: RequestContext, @Args('id') id: ID): Promise<boolean> {
        await this.paymentTemplateService.delete(ctx, id);
        return true;
    }

    @Mutation()
    @Transaction()
    @Allow(PaymentTemplatePermissions.CreatePaymentMethodFromTemplate as Permission)
    async createPaymentMethodFromTemplate(
        @Ctx() ctx: RequestContext,
        @Args('templateId') templateId: ID,
        @Args('name', { nullable: true }) name?: string,
        @Args('code', { nullable: true }) code?: string,
    ): Promise<any> {
        return this.paymentTemplateService.createPaymentMethodFromTemplate(ctx, templateId, name, code);
    }
}