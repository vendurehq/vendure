import { CreateShippingMethodInput, UpdateShippingMethodInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { ShippingMethod } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type ShippingMethodInputTypes = CreateShippingMethodInput | UpdateShippingMethodInput | ID;

/**
 * @description
 * This event is fired whenever a {@link ShippingMethod} is added, updated
 * or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class ShippingMethodEvent extends VendureEntityEvent<ShippingMethod, ShippingMethodInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: ShippingMethod,
        type: 'created' | 'updated' | 'deleted',
        input?: ShippingMethodInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
