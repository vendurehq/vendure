import { StockMovementType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne, TableInheritance } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomStockMovementFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { StockLocation } from '../stock-location/stock-location.entity';

/**
 * @description
 * A StockMovement is created whenever stock of a particular ProductVariant goes in
 * or out.
 *
 * @docsCategory entities
 * @docsPage StockMovement
 * @docsWeight 0
 */
@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'discriminator' } })
@Index(['discriminator'])
export abstract class StockMovement extends VendureEntity implements HasCustomFields {
    @Column({ nullable: false, type: 'varchar' })
    readonly type: StockMovementType;

    @Index()
    @ManyToOne(type => ProductVariant, variant => variant.stockMovements)
    productVariant: ProductVariant;

    @Index()
    @ManyToOne(type => StockLocation, stockLocation => stockLocation.stockMovements, { onDelete: 'CASCADE' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column()
    quantity: number;

    /**
     * @description
     * Whether this movement changed the StockLevel figures, i.e. whether inventory was tracked
     * for the ProductVariant at this StockLocation when the movement was recorded. Releases,
     * Sales and Cancellations follow what the earlier movements of the same OrderLine did,
     * not the current setting, so changing `trackInventory` while an Order is open cannot
     * leave allocated stock behind or release stock that was never allocated.
     *
     * StockAdjustments are always `true`: they change `stockOnHand` whatever the setting.
     *
     * Movements recorded before v4.0 are filled in by the `backfillStockMovementTracking()`
     * migration helper. Any still `null` fall back to the current setting.
     *
     * @since 4.0.0
     */
    @Column({ type: Boolean, nullable: true })
    tracked: boolean | null;

    @Column(type => CustomStockMovementFields)
    customFields: CustomStockMovementFields;
}
