import { CreatePaymentMethodInput, UpdatePaymentMethodInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { PaymentMethod } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type PaymentMethodInputTypes = CreatePaymentMethodInput | UpdatePaymentMethodInput | ID;

/**
 * @description
 * This event is fired whenever a {@link PaymentMethod} is added, updated
 * or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class PaymentMethodEvent extends VendureEntityEvent<PaymentMethod, PaymentMethodInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: PaymentMethod,
        type: 'created' | 'updated' | 'deleted',
        input?: PaymentMethodInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
