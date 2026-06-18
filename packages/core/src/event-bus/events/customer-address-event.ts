import { CreateAddressInput, UpdateAddressInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api';
import { Address } from '../../entity/address/address.entity';
import { VendureEntityEvent } from '../vendure-entity-event';

/**
 * Possible input types for Address mutations
 */
type CustomerAddressInputTypes = CreateAddressInput | UpdateAddressInput | ID;

/**
 * @description
 * This event is fired whenever a {@link Address} is added, updated
 * or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class CustomerAddressEvent extends VendureEntityEvent<Address, CustomerAddressInputTypes> {
    constructor(
        public ctx: RequestContext,
        public entity: Address,
        public type: 'created' | 'updated' | 'deleted',
        public input?: CustomerAddressInputTypes,
    ) {
        super(entity, type, ctx, input);
    }

    /**
     * Return an address field to become compatible with the
     * deprecated old version of CustomerAddressEvent
     * @deprecated Use `entity` instead
     */
    get address(): Address {
        return this.entity;
    }
}
