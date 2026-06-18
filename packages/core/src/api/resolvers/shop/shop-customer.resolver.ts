import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    MutationDeleteCustomerAddressArgs,
    MutationUpdateCustomerArgs,
    Success,
} from '@vendure/common/lib/generated-shop-types';
import {
    MutationCreateCustomerAddressArgs,
    MutationUpdateCustomerAddressArgs,
    Permission,
} from '@vendure/common/lib/generated-types';

import { ForbiddenError, InternalServerError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { Address, Customer } from '../../../entity';
import { CustomerService } from '../../../service/services/customer.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';
import { Transaction } from '../../decorators/transaction.decorator';

@Resolver()
export class ShopCustomerResolver {
    constructor(private customerService: CustomerService) {}

    @Query()
    @Allow(Permission.Owner)
    async activeCustomer(@Ctx() ctx: RequestContext): Promise<Customer | undefined> {
        const userId = ctx.activeUserId;
        if (userId) {
            return this.customerService.findOneByUserId(ctx, userId);
        }
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async updateCustomer(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateCustomerArgs,
    ): Promise<Customer> {
        const customer = await this.getCustomerForOwner(ctx);
        return this.customerService.update(ctx, {
            id: customer.id,
            ...args.input,
        });
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async createCustomerAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationCreateCustomerAddressArgs,
    ): Promise<Address> {
        const customer = await this.getCustomerForOwner(ctx);
        return this.customerService.createAddress(ctx, customer.id, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async updateCustomerAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationUpdateCustomerAddressArgs,
    ): Promise<Address> {
        const customer = await this.getCustomerForOwner(ctx);
        const customerAddresses = await this.customerService.findAddressesByCustomerId(ctx, customer.id);
        if (!customerAddresses.find(address => idsAreEqual(address.id, args.input.id))) {
            throw new ForbiddenError();
        }
        return this.customerService.updateAddress(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(Permission.Owner)
    async deleteCustomerAddress(
        @Ctx() ctx: RequestContext,
        @Args() args: MutationDeleteCustomerAddressArgs,
    ): Promise<Success> {
        const customer = await this.getCustomerForOwner(ctx);
        const customerAddresses = await this.customerService.findAddressesByCustomerId(ctx, customer.id);
        if (!customerAddresses.find(address => idsAreEqual(address.id, args.id))) {
            throw new ForbiddenError();
        }
        const success = await this.customerService.deleteAddress(ctx, args.id);
        return { success };
    }

    /**
     * Returns the Customer entity associated with the current user.
     */
    private async getCustomerForOwner(ctx: RequestContext): Promise<Customer> {
        const userId = ctx.activeUserId;
        if (!userId) {
            throw new ForbiddenError();
        }
        const customer = await this.customerService.findOneByUserId(ctx, userId);
        if (!customer) {
            throw new InternalServerError('error.no-customer-found-for-current-user');
        }
        return customer;
    }
}
