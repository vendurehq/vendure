import { Resolver } from '@nestjs/graphql';

import { PaymentMethodService } from '../../../service/services/payment-method.service';

@Resolver('PaymentMethod')
export class PaymentMethodEntityResolver {
    constructor(private paymentMethodService: PaymentMethodService) {}
}
