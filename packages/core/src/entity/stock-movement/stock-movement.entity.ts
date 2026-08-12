import { StockMovementType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne, TableInheritance } from 'typeorm';

import { DEFAULT_STOCK_LOCATION_PARTITION_KEY } from '../../common/constants';
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

    /**
     * @description
     * An optional key that identifies which stock partition this movement is associated with.
     * When set, it corresponds to the {@link StockLevel}'s `partitionKey`, enabling
     * per-partition stock movement history (e.g. tracking movements for a specific batch or lot).
     *
     * Defaults to an empty string, which indicates the default (non-partitioned) stock.
     *
     * @default ''
     * @since 3.7.0
     */
    @Column({ default: DEFAULT_STOCK_LOCATION_PARTITION_KEY })
    partitionKey: string;

    @Column()
    quantity: number;

    @Column(type => CustomStockMovementFields)
    customFields: CustomStockMovementFields;
}
