import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    ConfigurableOperationDefinition,
    DeletionResponse,
    MutationAssignShippingMethodsToChannelArgs,
    MutationCreateShippingMethodArgs,
    MutationDeleteShippingMethodArgs,
    MutationDeleteShippingMethodsArgs,
    MutationRemoveShippingMethodsFromChannelArgs,
    MutationUpdateShippingMethodArgs,
    Permission,
    QueryShippingMethodArgs,
    QueryShippingMethodsArgs,
    QueryTestEligibleShippingMethodsArgs,
    QueryTestShippingMethodArgs,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Translated } from '../../../common/types/locale-types';
import { ShippingMethod } from '../../../entity/shipping-method/shipping-method.entity';
import { OrderTestingService } from '../../../service/services/order-testing.service';
import { ShippingMethodService } from '../../../service/services/shipping-method.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver('ShippingMethod')
export class ShippingMethodResolver {
    constructor(
        private shippingMethodService: ShippingMethodService,
        private orderTestingService: OrderTestingService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadShippingMethod)
    shippingMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryShippingMethodsArgs,
        @Relations(ShippingMethod) relations: RelationPaths<ShippingMethod>,
    ): Promise<PaginatedList<ShippingMethod>> {
        return this.shippingMethodService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadShippingMethod)
    shippingMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryShippingMethodArgs,
        @Relations(ShippingMethod) relations: RelationPaths<ShippingMethod>,
    ): Promise<ShippingMethod | undefined> {
        return this.shippingMethodService.findOne(ctx, args.id, false, relations);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadOrder, Permission.ReadShippingMethod)
    shippingEligibilityCheckers(@Ctx() ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.shippingMethodService.getShippingEligibilityCheckers(ctx);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadOrder, Permission.ReadShippingMethod)
    shippingCalculators(@Ctx() ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.shippingMethodService.getShippingCalculators(ctx);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadOrder, Permission.ReadShippingMethod)
    fulfillmentHandlers(@Ctx() ctx: RequestContext): ConfigurableOperationDefinition[] {
        return this.shippingMethodService.getFulfillmentHandlers(ctx);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateSettings, Permission.CreateShippingMethod)
    createShippingMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateShippingMethodArgs,
    ): Promise<ShippingMethod> {
        const { input } = args;
        return this.shippingMethodService.create(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateShippingMethod)
    updateShippingMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateShippingMethodArgs,
    ): Promise<ShippingMethod> {
        const { input } = args;
        return this.shippingMethodService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteShippingMethod)
    deleteShippingMethod(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteShippingMethodArgs,
    ): Promise<DeletionResponse> {
        const { id } = args;
        return this.shippingMethodService.softDelete(ctx, id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteShippingMethod)
    deleteShippingMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteShippingMethodsArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids?.map(id => this.shippingMethodService.softDelete(ctx, id)) ?? []);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadShippingMethod)
    testShippingMethod(@Ctx() ctx: RequestContext, @Args() args: QueryTestShippingMethodArgs) {
        const { input } = args;
        return this.orderTestingService.testShippingMethod(ctx, input);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadShippingMethod)
    testEligibleShippingMethods(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryTestEligibleShippingMethodsArgs,
    ) {
        const { input } = args;
        return this.orderTestingService.testEligibleShippingMethods(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateShippingMethod)
    async assignShippingMethodsToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationAssignShippingMethodsToChannelArgs,
    ): Promise<Array<Translated<ShippingMethod>>> {
        return await this.shippingMethodService.assignShippingMethodsToChannel(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteShippingMethod)
    async removeShippingMethodsFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationRemoveShippingMethodsFromChannelArgs,
    ): Promise<Array<Translated<ShippingMethod>>> {
        return await this.shippingMethodService.removeShippingMethodsFromChannel(ctx, args.input);
    }
}
