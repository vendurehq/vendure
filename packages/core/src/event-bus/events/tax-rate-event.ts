import { CreateTaxRateInput, UpdateTaxRateInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { TaxRate } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type TaxRateInputTypes = CreateTaxRateInput | UpdateTaxRateInput | ID;

/**
 * @description
 * The target of a {@link TaxRate} before an update: the Zone or the country Region it applied to.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 4.0.0
 */
export interface TaxRateTargetIds {
    zoneId: ID | null;
    regionId: ID | null;
}

/**
 * @description
 * This event is fired whenever a {@link TaxRate} is added, updated
 * or deleted. On an update, `previousTarget` holds the Zone or country the rate targeted before.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class TaxRateEvent extends VendureEntityEvent<TaxRate, TaxRateInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: TaxRate,
        type: 'created' | 'updated' | 'deleted',
        input?: TaxRateInputTypes,
        public previousTarget?: TaxRateTargetIds,
    ) {
        super(entity, type, ctx, input);
    }
}
