import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Asset } from '../asset/asset.entity';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomProductFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { FacetValue } from '../facet-value/facet-value.entity';
import { ProductOptionGroup } from '../product-option-group/product-option-group.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';

import { ProductAsset } from './product-asset.entity';
import { ProductTranslation } from './product-translation.entity';

/**
 * @description
 * A Product contains one or more {@link ProductVariant}s and serves as a container for those variants,
 * providing an overall name, description etc.
 *
 * @docsCategory entities
 */
@Entity()
export class Product
    extends VendureEntity
    implements Translatable, HasCustomFields, ChannelAware, SoftDeletable
{
    constructor(input?: DeepPartial<Product>) {
        super(input);
    }

    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    name: LocaleString;

    slug: LocaleString;

    description: LocaleString;

    @Column({ default: true })
    enabled: boolean;

    @Index()
    @ManyToOne(type => Asset, asset => asset.featuredInProducts, { onDelete: 'SET NULL' })
    featuredAsset: Asset;

    @EntityId({ nullable: true })
    featuredAssetId: ID;

    @OneToMany(type => ProductAsset, productAsset => productAsset.product)
    assets: ProductAsset[];

    @OneToMany(type => ProductTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<Product>>;

    @OneToMany(type => ProductVariant, variant => variant.product)
    variants: ProductVariant[];

    @ManyToMany(type => ProductOptionGroup, optionGroup => optionGroup.products)
    @JoinTable()
    optionGroups: ProductOptionGroup[];

    @ManyToMany(type => FacetValue, facetValue => facetValue.products)
    @JoinTable()
    facetValues: FacetValue[];

    @ManyToMany(type => Channel, channel => channel.products)
    @JoinTable()
    channels: Channel[];

    @Column(type => CustomProductFields)
    customFields: CustomProductFields;
}
