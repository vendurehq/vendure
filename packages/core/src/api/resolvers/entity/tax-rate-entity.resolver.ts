import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';

import { Channel } from '../../../entity/channel/channel.entity';
import { CustomerGroup } from '../../../entity/customer-group/customer-group.entity';
import { TaxRate } from '../../../entity/tax-rate/tax-rate.entity';
import { RoleService } from '../../../service/services/role.service';
import { TaxRateService } from '../../../service/services/tax-rate.service';
import { RequestContext } from '../../common/request-context';
import { Allow } from '../../decorators/allow.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('TaxRate')
export class TaxRateEntityResolver {
    constructor(private taxRateService: TaxRateService) {}

    @Allow(Permission.ReadCustomer, Permission.ReadCustomerGroup)
    @ResolveField()
    async customerGroup(
        @Ctx() ctx: RequestContext,
        @Parent() taxRate: TaxRate,
    ): Promise<CustomerGroup | undefined> {
        if (taxRate.customerGroup) {
            return taxRate.customerGroup;
        }

        return (await this.taxRateService.findOne(ctx, taxRate.id))?.customerGroup;
    }
}
