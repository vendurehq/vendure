import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, JoinTable, ManyToMany, OneToMany } from 'typeorm';

import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomProductOptionGroupFields } from '../custom-entity-fields';
import { ProductOption } from '../product-option/product-option.entity';
import { Product } from '../product/product.entity';

import { ProductOptionGroupTranslation } from './product-option-group-translation.entity';

/**
 * @description
 * A grouping of one or more {@link ProductOption}s.
 *
 * @docsCategory entities
 */
@Entity()
export class ProductOptionGroup
    extends VendureEntity
    implements Translatable, HasCustomFields, SoftDeletable, ChannelAware
{
    constructor(input?: DeepPartial<ProductOptionGroup>) {
        super(input);
    }
    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    name: LocaleString;

    @Column()
    code: string;

    @OneToMany(type => ProductOptionGroupTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ProductOptionGroup>>;

    @OneToMany(type => ProductOption, option => option.group)
    options: ProductOption[];

    @ManyToMany(type => Product, product => product.optionGroups)
    products: Product[];

    @ManyToMany(type => Channel, channel => channel.productOptionGroups)
    @JoinTable()
    channels: Channel[];

    @Column(type => CustomProductOptionGroupFields)
    customFields: CustomProductOptionGroupFields;
}
