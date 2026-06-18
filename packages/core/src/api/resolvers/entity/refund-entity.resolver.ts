import { Parent, ResolveField, Resolver } from '@nestjs/graphql';

import { idsAreEqual } from '../../../common/utils';
import { Refund } from '../../../entity/refund/refund.entity';
import { PaymentService } from '../../../service/services/payment.service';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Refund')
export class RefundEntityResolver {
    constructor(private paymentService: PaymentService) {}

    @ResolveField()
    async lines(@Ctx() ctx: RequestContext, @Parent() refund: Refund) {
        if (refund.lines) {
            return refund.lines;
        }
        const payment = await this.paymentService.findOneOrThrow(ctx, refund.paymentId, ['refunds.lines']);
        return payment.refunds.find(r => idsAreEqual(r.id, refund.id))?.lines ?? [];
    }
}
