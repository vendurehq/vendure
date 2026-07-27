import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ConfigurableOperation } from '@vendure/common/lib/generated-types';

import { PaymentMethodEligibilityChecker } from '../../../config/payment/payment-method-eligibility-checker';
import { PaymentMethodHandler } from '../../../config/payment/payment-method-handler';
import { PaymentMethod } from '../../../entity/payment-method/payment-method.entity';
import { ConfigurableOperationCodec } from '../../common/configurable-operation-codec';
import { RequestContext } from '../../common/request-context';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('PaymentMethod')
export class PaymentMethodEntityResolver {
    constructor(private configurableOperationCodec: ConfigurableOperationCodec) {}

    @ResolveField()
    async handler(
        @Ctx() ctx: RequestContext,
        @Parent() paymentMethod: PaymentMethod,
    ): Promise<ConfigurableOperation> {
        const [handler] = await this.configurableOperationCodec.redactSecretArgs(
            ctx,
            PaymentMethodHandler,
            [paymentMethod.handler],
            paymentMethod,
        );
        return handler;
    }

    @ResolveField()
    async checker(
        @Ctx() ctx: RequestContext,
        @Parent() paymentMethod: PaymentMethod,
    ): Promise<ConfigurableOperation | null> {
        if (!paymentMethod.checker) {
            return null;
        }
        const [checker] = await this.configurableOperationCodec.redactSecretArgs(
            ctx,
            PaymentMethodEligibilityChecker,
            [paymentMethod.checker],
            paymentMethod,
        );
        return checker;
    }
}
