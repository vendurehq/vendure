import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Permission, QueryCustomersArgs } from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { Customer } from '../../../entity/customer/customer.entity';
import { CustomerGroup } from '../../../entity/customer-group/customer-group.entity';
import { CustomerGroupService } from '../../../service/services/customer-group.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('CustomerGroup')
export class CustomerGroupEntityResolver {
    constructor(private customerGroupService: CustomerGroupService) {}

    @Allow(Permission.ReadCustomer)
    @ResolveField()
    async customers(
        @Ctx() ctx: RequestContext,
        @Parent() customerGroup: CustomerGroup,
        @Args() args: QueryCustomersArgs,
    ): Promise<PaginatedList<Customer>> {
        return this.customerGroupService.getGroupCustomers(ctx, customerGroup.id, args.options || undefined);
    }
}
