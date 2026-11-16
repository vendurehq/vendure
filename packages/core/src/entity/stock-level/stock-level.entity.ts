import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomStockLevelFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { StockLocation } from '../stock-location/stock-location.entity';

/**
 * @description
 * A StockLevel represents the number of a particular {@link ProductVariant} which are available
 * at a particular {@link StockLocation}.
 *
 * @docsCategory entities
 */
@Entity()
@Index(['productVariantId', 'stockLocationId'], { unique: true })
export class StockLevel extends VendureEntity implements HasCustomFields {
    constructor(input: DeepPartial<StockLevel>) {
        super(input);
    }

    @Index()
    @ManyToOne(type => ProductVariant, productVariant => productVariant.stockLevels, { onDelete: 'CASCADE' })
    productVariant: ProductVariant;

    @EntityId()
    productVariantId: ID;

    @Index()
    @ManyToOne(type => StockLocation, { onDelete: 'CASCADE' })
    stockLocation: StockLocation;

    @EntityId()
    stockLocationId: ID;

    @Column()
    stockOnHand: number;

    @Column()
    stockAllocated: number;

    /**
     * @description
     * Whether inventory is tracked for this ProductVariant at this StockLocation.
     * `INHERIT` defers to {@link ProductVariant}`.trackInventory`, which in turn defers to
     * {@link Channel}`.trackInventory`. See {@link resolveTrackInventory}.
     *
     * @since 4.0.0
     */
    @Column({ type: 'varchar', default: GlobalFlag.INHERIT })
    trackInventory: GlobalFlag;

    @Column(type => CustomStockLevelFields)
    customFields: CustomStockLevelFields;
}
