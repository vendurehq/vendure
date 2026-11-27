import { Args, Info, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Permission, QueryCustomersArgs } from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';
import { GraphQLResolveInfo } from 'graphql';

import { Customer } from '../../../entity/customer/customer.entity';
import { CustomerGroup } from '../../../entity/customer-group/customer-group.entity';
import { CustomerGroupService } from '../../../service/services/customer-group.service';
import { IdArgumentDecoder } from '../../common/id-argument-decoder';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('CustomerGroup')
export class CustomerGroupEntityResolver {
    constructor(
        private customerGroupService: CustomerGroupService,
        private idArgumentDecoder: IdArgumentDecoder,
    ) {}

    @Allow(Permission.ReadCustomer)
    @ResolveField()
    async customers(
        @Ctx() ctx: RequestContext,
        @Parent() customerGroup: CustomerGroup,
        @Args() args: QueryCustomersArgs,
        @Info() info: GraphQLResolveInfo,
    ): Promise<PaginatedList<Customer>> {
        const { options } = this.idArgumentDecoder.decode(info, args);
        return this.customerGroupService.getGroupCustomers(ctx, customerGroup.id, options || undefined);
    }
}
