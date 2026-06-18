import { EntityRelationPaths } from '../../../common/types/entity-relation-paths';
import { VendureEntity } from '../../../entity/base/base.entity';

/**
 * @description
 * Options used to control which relations of the entity get hydrated
 * when using the {@link EntityHydrator} helper.
 *
 * @since 1.3.0
 * @docsCategory data-access
 */
export interface HydrateOptions<Entity extends VendureEntity> {
    /**
     * @description
     * Defines the relations to hydrate, using strings with dot notation to indicate
     * nested joins. If the entity already has a particular relation available, that relation
     * will be skipped (no extra DB join will be added).
     */
    relations: Array<EntityRelationPaths<Entity>>;
    /**
     * @description
     * If set to `true`, any ProductVariants will also have their `price` and `priceWithTax` fields
     * applied based on the current context. If prices are not required, this can be left `false` which
     * will be slightly more efficient.
     *
     * @default false
     */
    applyProductVariantPrices?: boolean;
}
