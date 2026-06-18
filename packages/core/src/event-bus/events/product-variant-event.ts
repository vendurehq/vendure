import { CreateProductVariantInput, UpdateProductVariantInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { ProductVariant } from '../../entity';
import { VendureEntityEvent } from '../vendure-entity-event';

type ProductVariantInputTypes = CreateProductVariantInput[] | UpdateProductVariantInput[] | ID | ID[];

/**
 * @description
 * This event is fired whenever a {@link ProductVariant} is added, updated
 * or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class ProductVariantEvent extends VendureEntityEvent<ProductVariant[], ProductVariantInputTypes> {
    constructor(
        ctx: RequestContext,
        entity: ProductVariant[],
        type: 'created' | 'updated' | 'deleted',
        input?: ProductVariantInputTypes,
    ) {
        super(entity, type, ctx, input);
    }

    /**
     * Return an variants field to become compatible with the
     * deprecated old version of ProductEvent
     * @deprecated Use `entity` instead
     * @since 1.4
     */
    get variants(): ProductVariant[] {
        return this.entity;
    }
}
