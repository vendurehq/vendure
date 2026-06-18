import { DeepPartial } from '@vendure/common/lib/shared-types';
import { EntityId, ID, Money, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, ManyToOne } from 'typeorm';
import { ProductBundle } from './product-bundle.entity';

@Entity()
export class ProductBundleItem extends VendureEntity {
    constructor(input?: DeepPartial<ProductBundleItem>) {
        super(input);
    }

    @ManyToOne(type => ProductVariant)
    productVariant: ProductVariant;

    @EntityId()
    productVariantId: ID;

    @ManyToOne(type => ProductBundle, bundle => bundle.items)
    bundle: ProductBundle;

    @EntityId()
    bundleId: ID;

    @Money()
    price: number;

    @Column()
    quantity: number;
}
