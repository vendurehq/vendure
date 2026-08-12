import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { DEFAULT_STOCK_LOCATION_PARTITION_KEY } from '../../common/constants';
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
@Index(['productVariantId', 'stockLocationId', 'partitionKey'], { unique: true })
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

    /**
     * @description
     * An optional key used to partition stock within a single StockLocation.
     * This enables use cases such as batch/lot tracking, serial number management,
     * or expiration-date-based stock rotation (FIFO/LIFO).
     *
     * When set to a non-empty string, multiple StockLevel records can exist for the
     * same ProductVariant and StockLocation combination, each identified by a unique
     * partitionKey.
     *
     * Defaults to an empty string, which preserves the existing behavior of a single
     * StockLevel per ProductVariant/StockLocation pair.
     *
     * @default ''
     * @since 3.7.0
     */
    @Column({ default: DEFAULT_STOCK_LOCATION_PARTITION_KEY })
    partitionKey: string;

    @Column()
    stockOnHand: number;

    @Column()
    stockAllocated: number;

    @Column(type => CustomStockLevelFields)
    customFields: CustomStockLevelFields;
}
