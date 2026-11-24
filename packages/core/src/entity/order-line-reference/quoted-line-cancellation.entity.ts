import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity } from 'typeorm';

import { Money } from '../money.decorator';

import { OrderLineReference } from './order-line-reference.entity';

/**
 * @description
 * The value removed from a quoted order line by one cancellation, including discounts and tax.
 * Refunds can use this amount after a subsequent modification changes the surviving units.
 *
 * @docsCategory entities
 * @docsPage OrderLineReference
 * @since 3.8.3
 */
@ChildEntity()
export class QuotedLineCancellation extends OrderLineReference {
    constructor(input?: DeepPartial<QuotedLineCancellation>) {
        super(input);
    }

    @Money({ nullable: true })
    priceWithTax: number;
}
