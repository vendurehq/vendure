import { Query, Resolver } from '@nestjs/graphql';

import { PaymentMethod } from '../../../entity/payment-method/payment-method.entity';
import { PaymentMethodService } from '../../../service/services/payment-method.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver()
export class ShopPaymentMethodsResolver {
    constructor(readonly paymentMethodService: PaymentMethodService) {}

    @Query()
    async activePaymentMethods(@Ctx() ctx: RequestContext): Promise<PaymentMethod[]> {
        return this.paymentMethodService.getActivePaymentMethods(ctx);
    }
}
