import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    ConfigurableOperationDefinition,
    DeletionResponse,
    MutationAssignPaymentMethodsToChannelArgs,
    MutationCreatePaymentMethodArgs,
    MutationDeletePaymentMethodArgs,
    MutationDeletePaymentMethodsArgs,
    MutationRemovePaymentMethodsFromChannelArgs,
    MutationUpdatePaymentMethodArgs,
    Permission,
    QueryPaymentMethodArgs,
    QueryPaymentMethodsArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Translated } from '../../../common/types/locale-types';
import { PaymentMethod } from '../../../entity/payment-method/payment-method.entity';
import { PaymentMethodService } from '../../../service/services/payment-method.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('PaymentMethod')
export class PaymentMethodResolver {
    constructor(private paymentMethodService: PaymentMethodService) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadPaymentMethod)
    paymentMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryPaymentMethodsArgs,
        @Relations(PaymentMethod) relations: RelationPaths<PaymentMethod>,
    ): Promise<PaginatedList<PaymentMethod>> {
        return this.paymentMethodService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadPaymentMethod)
    paymentMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryPaymentMethodArgs,
        @Relations(PaymentMethod) relations: RelationPaths<PaymentMethod>,
    ): Promise<PaymentMethod | undefined> {
        return this.paymentMethodService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreatePaymentMethod)
    createPaymentMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreatePaymentMethodArgs,
    ): Promise<PaymentMethod> {
        return this.paymentMethodService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdatePaymentMethod)
    updatePaymentMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdatePaymentMethodArgs,
    ): Promise<PaymentMethod> {
        return this.paymentMethodService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeletePaymentMethod)
    deletePaymentMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeletePaymentMethodArgs,
    ): Promise<DeletionResponse> {
        return this.paymentMethodService.delete(ctx, args.id, args.force);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeletePaymentMethod)
    deletePaymentMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeletePaymentMethodsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.paymentMethodService.delete(ctx, id, args.force)));
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadPaymentMethod)
    paymentMethodHandlers(@Ctx() ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.paymentMethodService.getPaymentMethodHandlers(ctx);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadPaymentMethod)
    paymentMethodEligibilityCheckers(@Ctx() ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.paymentMethodService.getPaymentMethodEligibilityCheckers(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdatePaymentMethod)
    async assignPaymentMethodsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignPaymentMethodsToChannelArgs,
    ): Promise<Array<Translated<PaymentMethod>>> {
        return await this.paymentMethodService.assignPaymentMethodsToChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeletePaymentMethod)
    async removePaymentMethodsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemovePaymentMethodsFromChannelArgs,
    ): Promise<Array<Translated<PaymentMethod>>> {
        return await this.paymentMethodService.removePaymentMethodsFromChannel(ctx, args.input);
    }
}
