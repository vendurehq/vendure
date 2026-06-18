import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity, Product, EntityId, ID, ProductVariant } from '@vendure/core';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { ProductBundleItem } from './product-bundle-item.entity';

@Entity()
export class ProductBundle extends VendureEntity {
    constructor(input?: DeepPartial<ProductBundle>) {
        super(input);
    }

    @OneToMany(type => ProductBundleItem, item => item.bundle)
    items: ProductBundleItem[];

    @Column()
    name: string;

    @Column()
    description: string;
}
