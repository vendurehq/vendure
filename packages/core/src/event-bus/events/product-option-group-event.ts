import {
    CreateProductOptionGroupInput,
    UpdateProductOptionGroupInput,
} from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { ProductOptionGroup } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type ProductOptionGroupInputTypes =
    | Omit<CreateProductOptionGroupInput, 'options'>
    | UpdateProductOptionGroupInput
    | ID;

/**
 * @description
 * This event is fired whenever a {@link ProductOptionGroup} is added or updated.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class ProductOptionGroupEvent extends VendureEntityEvent<
    ProductOptionGroup,
    ProductOptionGroupInputTypes
> {
    constructor(
        ctx: RequestContext,
        entity: ProductOptionGroup,
        type: 'created' | 'updated' | 'deleted',
        input?: ProductOptionGroupInputTypes,
    ) {
        super(entity, type, ctx, input);
    }
}
