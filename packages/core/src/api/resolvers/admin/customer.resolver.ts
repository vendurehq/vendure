import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    CreateCustomerResult,
    DeletionResponse,
    MutationAddNoteToCustomerArgs,
    MutationCreateCustomerAddressArgs,
    MutationCreateCustomerArgs,
    MutationDeleteCustomerAddressArgs,
    MutationDeleteCustomerArgs,
    MutationDeleteCustomerNoteArgs,
    MutationDeleteCustomersArgs,
    MutationUpdateCustomerAddressArgs,
    MutationUpdateCustomerArgs,
    MutationUpdateCustomerNoteArgs,
    Permission,
    QueryCustomerArgs,
    QueryCustomersArgs,
    Success,
    UpdateCustomerResult,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ErrorResultUnion } from '../../../common/error/error-result';
import { Address } from '../../../entity/address/address.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { CustomerGroupService } from '../../../service/services/customer-group.service';
import { CustomerService } from '../../../service/services/customer.service';
import { OrderService } from '../../../service/services/order.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class CustomerResolver {
    constructor(
        private customerService: CustomerService,
        private customerGroupService: CustomerGroupService,
        private orderService: OrderService,
    ) {}

    @Query()
    @Allow(Permission.ReadCustomer)
    async customers(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryCustomersArgs,
        @Relations({ entity: Customer, omit: ['orders'] }) relations: RelationPaths<Customer>,
    ): Promise<PaginatedList<Customer>> {
        return this.customerService.findAll(ctx, args.options || undefined, relations);
    }

    @Query()
    @Allow(Permission.ReadCustomer)
    async customer(
        @Ctx() ctx: RequestContext,
        @Args() args: QueryCustomerArgs,
        @Relations({ entity: Customer, omit: ['orders'] }) relations: RelationPaths<Customer>,
    ): Promise<Customer | undefined> {
        return this.customerService.findOne(ctx, args.id, relations);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateCustomer)
    async createCustomer(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateCustomerArgs,
    ): Promise<ErrorResultUnion<CreateCustomerResult, Customer>> {
        const { input, password } = args;
        return this.customerService.create(ctx, input, password || undefined);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async updateCustomer(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateCustomerArgs,
    ): Promise<ErrorResultUnion<UpdateCustomerResult, Customer>> {
        const { input } = args;
        return this.customerService.update(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.CreateCustomer)
    async createCustomerAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateCustomerAddressArgs,
    ): Promise<Address> {
        const { customerId, input } = args;
        return this.customerService.createAddress(ctx, customerId, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async updateCustomerAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateCustomerAddressArgs,
    ): Promise<Address> {
        const { input } = args;
        return this.customerService.updateAddress(ctx, input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCustomer)
    async deleteCustomerAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteCustomerAddressArgs,
    ): Promise<Success> {
        const { id } = args;
        const success = await this.customerService.deleteAddress(ctx, id);
        return { success };
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCustomer)
    async deleteCustomer(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteCustomerArgs,
    ): Promise<DeletionResponse> {
        const groups = await this.customerService.getCustomerGroups(ctx, args.id);
        for (const group of groups) {
            await this.customerGroupService.removeCustomersFromGroup(ctx, {
                customerGroupId: group.id,
                customerIds: [args.id],
            });
        }
        return this.customerService.softDelete(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.DeleteCustomer)
    async deleteCustomers(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteCustomersArgs,
    ): Promise<DeletionResponse[]> {
        return Promise.all(args.ids.map(id => this.deleteCustomer(ctx, { id })));
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async addNoteToCustomer(@Ctx() ctx: RequestContext, @Args() args: MutationAddNoteToCustomerArgs) {
        return this.customerService.addNoteToCustomer(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async updateCustomerNote(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateCustomerNoteArgs) {
        return this.customerService.updateCustomerNote(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.UpdateCustomer)
    async deleteCustomerNote(@Ctx() ctx: RequestContext, @Args() args: MutationDeleteCustomerNoteArgs) {
        return this.customerService.deleteCustomerNote(ctx, args.id);
    }
}
