import { Query, Resolver } from '@nestjs/graphql';

import { ShippingMethod } from '../../../entity/shipping-method/shipping-method.entity';
import { ShippingMethodService } from '../../../service/services/shipping-method.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver()
export class ShopShippingMethodsResolver {
    constructor(readonly shippingMethodService: ShippingMethodService) {}

    @Query()
    async activeShippingMethods(@Ctx() ctx: RequestContext): Promise<ShippingMethod[]> {
        return this.shippingMethodService.getActiveShippingMethods(ctx);
    }
}
