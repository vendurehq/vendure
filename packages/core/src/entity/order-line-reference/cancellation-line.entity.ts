import { DeepPartial } from '@vendure/common/lib/shared-types';
import { ChildEntity } from 'typeorm';

import { Money } from '../money.decorator';

import { OrderLineReference } from './order-line-reference.entity';

/**
 * @description
 * Records the value of the units that one cancellation removed from an {@link OrderLine},
 * including discounts. Vendure records it for every partial or full cancellation. Refunds of a
 * line priced by `OrderItemPriceCalculationStrategy.calculateLinePrice` use it, so a later
 * repricing or promotion change does not alter the refund for units that were already cancelled.
 *
 * This is unrelated to the `Cancellation` stock movement, which Vendure creates per stock
 * location and only for allocated units.
 *
 * @internal
 */
@ChildEntity()
export class CancellationLine extends OrderLineReference {
    constructor(input?: DeepPartial<CancellationLine>) {
        super(input);
    }

    @Money({ nullable: true })
    price: number;

    @Money({ nullable: true })
    priceWithTax: number;
}
