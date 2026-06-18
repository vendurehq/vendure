import { CreateFacetInput, UpdateFacetInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api';
import { Facet } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type FacetInputTypes = CreateFacetInput | UpdateFacetInput | ID;

/**
 * @description
 * This event is fired whenever a {@link Facet} is added, updated or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class FacetEvent extends VendureEntityEvent<Facet, FacetInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: Facet,
        type: 'created' | 'updated' | 'deleted',
        input?: FacetInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
