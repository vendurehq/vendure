import { DeepPartial, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, ManyToOne } from 'typeorm';
import { SupplierStock } from './supplier-stock.entity';

/**
 * @description This entity represents a SupplierInTransit information
 *
 * @docsCategory entities
 */
@Entity('supplier_stock_in_transit')
export class SupplierStockInTransit extends VendureEntity {
  constructor(input?: DeepPartial<SupplierStockInTransit>) {
    super(input);
  }

  @Column({ nullable: true })
  channelName?: string;

  @Column()
  channelOrderNo: string;

  @Column()
  quantity: number;

  @ManyToOne(
    () => SupplierStock,
    (supplierStock) => supplierStock.stocksInTransits
  )
  supplierStock: SupplierStock;

  @Column({ type: 'int' })
  supplierStockId: ID;
}
