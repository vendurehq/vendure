import {
  DeepPartial,
  ID,
  Product,
  ProductVariant,
  VendureEntity,
} from '@vendure/core';
import { Column, Entity, OneToMany, ManyToOne } from 'typeorm';
import { SupplierStockInTransit } from './supplier-stock-in-transit.entity';

/**
 * @description This entity represents a supplier virtual stock
 *
 * @docsCategory entities
 */
@Entity('supplier_stock')
export class SupplierStock extends VendureEntity {
  constructor(input?: DeepPartial<SupplierStock>) {
    super(input);
  }

  @Column({ default: 0 })
  stockOnHand: number;

  @Column({ default: 0 })
  virtualStock: number;

  @Column({ default: 0 })
  inTransitsStock: number;

  @Column({ nullable: true })
  stockArea: string;

  @OneToMany(() => SupplierStockInTransit, (type) => type.supplierStock)
  stocksInTransits: SupplierStockInTransit[];

  @Column({ default: true })
  enabled: boolean;

  @Column({ nullable: true })
  link?: string;

  @Column({ nullable: true, type: 'simple-json' })
  tags?: string[];

  @Column({ type: 'tinytext', nullable: true })
  comment?: string;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
  productVariant: ProductVariant;

  @Column('int')
  productVariantId: ID;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  product: Product;

  @Column('int', { nullable: true })
  productId: ID;
}
