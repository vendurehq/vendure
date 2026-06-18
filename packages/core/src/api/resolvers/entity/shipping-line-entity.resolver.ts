import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { ShippingMethodService } from '../../../service/services/shipping-method.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('ShippingLine')
export class ShippingLineEntityResolver {
    constructor(private shippingMethodService: ShippingMethodService) {}

    @ResolveField()
    async shippingMethod(@Ctx() ctx: RequestContext, @Parent() shippingLine: ShippingLine) {
        if (shippingLine.shippingMethodId) {
            // Does not need to be decoded because it is an internal property
            // which is never exposed to the outside world.
            const shippingMethodId = shippingLine.shippingMethodId;
            return this.shippingMethodService.findOne(ctx, shippingMethodId, true);
        } else {
            return null;
        }
    }
}
