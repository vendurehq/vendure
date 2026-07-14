import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { HistoryEntryListOptions, QueryOrdersArgs, SortOrder } from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Address } from '../../../entity/address/address.entity';
import { Customer } from '../../../entity/customer/customer.entity';
import { Order } from '../../../entity/order/order.entity';
import { CustomerService } from '../../../service/services/customer.service';
import { HistoryService } from '../../../service/services/history.service';
import { OrderService } from '../../../service/services/order.service';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { Api } from '../../decorators/api.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Customer')
export class CustomerEntityResolver {
    constructor(
        private customerService: CustomerService,
        private orderService: OrderService,
    ) {}
    @ResolveField()
    async addresses(
        @Ctx() ctx: RequestContext,
        @Parent() customer: Customer,
        @Api() apiType: ApiType,
    ): Promise<Address[]> {
        if (apiType === 'shop' && !ctx.activeUserId) {
            // Guest customers should not be able to see this data
            return [];
        }
        return this.customerService.findAddressesByCustomerId(ctx, customer.id);
    }

    @ResolveField()
    async orders(
        @Ctx() ctx: RequestContext,
        @Parent() customer: Customer,
        @Args() args: QueryOrdersArgs,
        @Api() apiType: ApiType,
        @Relations(Order) relations: RelationPaths<Order>,
    ): Promise<PaginatedList<Order>> {
        if (apiType === 'shop' && !ctx.activeUserId) {
            // Guest customers should not be able to see this data
            return { items: [], totalItems: 0 };
        }
        return this.orderService.findByCustomerId(ctx, customer.id, args.options || undefined, relations);
    }

    @ResolveField()
    async user(@Ctx() ctx: RequestContext, @Parent() customer: Customer) {
        if (customer.user) {
            return customer.user;
        }
        // Re-load the customer's actual user relation rather than looking up by email,
        // since an email lookup can return a User belonging to a different Customer entity.
        const loaded = await this.customerService.findOne(ctx, customer.id, ['user']);
        return loaded?.user ?? null;
    }
}

@Resolver('Customer')
export class CustomerAdminEntityResolver {
    constructor(
        private customerService: CustomerService,
        private historyService: HistoryService,
    ) {}

    @ResolveField()
    groups(@Ctx() ctx: RequestContext, @Parent() customer: Customer) {
        if (customer.groups) {
            return customer.groups;
        }
        return this.customerService.getCustomerGroups(ctx, customer.id);
    }

    @ResolveField()
    async history(
        @Ctx() ctx: RequestContext,
        @Api() apiType: ApiType,
        @Parent() order: Order,
        @Args() args: any,
    ) {
        const publicOnly = apiType === 'shop';
        const options: HistoryEntryListOptions = { ...args.options };
        if (!options.sort) {
            options.sort = { createdAt: SortOrder.ASC };
        }
        return this.historyService.getHistoryForCustomer(ctx, order.id, publicOnly, options);
    }
}
