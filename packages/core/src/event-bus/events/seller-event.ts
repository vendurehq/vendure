import { CreateSellerInput, UpdateSellerInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Role } from '../../entity';
import { Seller } from '../../entity/seller/seller.entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type SellerInputTypes = CreateSellerInput | UpdateSellerInput | ID;

/**
 * @description
 * This event is fired whenever one {@link Seller} is added, updated or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 2.0.1
 */
export class SellerEvent extends VendureEntityEvent<Seller, SellerInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: Seller,
        type: 'created' | 'updated' | 'deleted',
        input?: SellerInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
