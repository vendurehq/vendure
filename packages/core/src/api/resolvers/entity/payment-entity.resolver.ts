import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { pick } from '@vendure/common/lib/pick';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { PaymentMetadata } from '../../../common/types/common-types';
import { Payment } from '../../../entity/payment/payment.entity';
import { Refund } from '../../../entity/refund/refund.entity';
import { PaymentService } from '../../../service';
import { OrderService } from '../../../service/services/order.service';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { Api } from '../../decorators/api.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Payment')
export class PaymentEntityResolver {
    constructor(
        private orderService: OrderService,
        private requestContextCache: RequestContextCacheService,
    ) {}

    @ResolveField()
    async refunds(@Ctx() ctx: RequestContext, @Parent() payment: Payment): Promise<Refund[]> {
        if (payment.refunds) {
            return payment.refunds;
        } else {
            return this.requestContextCache.get(ctx, `PaymentEntityResolver.refunds(${payment.id})`, () =>
                this.orderService.getPaymentRefunds(ctx, payment.id),
            );
        }
    }

    @ResolveField()
    metadata(@Api() apiType: ApiType, @Parent() payment: Payment): PaymentMetadata {
        return apiType === 'admin' ? payment.metadata : pick(payment.metadata, ['public']);
    }
}

@Resolver('Payment')
export class PaymentAdminEntityResolver {
    constructor(private paymentService: PaymentService) {}

    @ResolveField()
    async nextStates(@Parent() payment: Payment) {
        return this.paymentService.getNextStates(payment);
    }
}
