import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';

import { ChannelAware, SoftDeletable } from '../../common/types/common-types';
import { LocaleString, Translatable, Translation } from '../../common/types/locale-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomProductOptionFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { ProductOptionGroup } from '../product-option-group/product-option-group.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';

import { ProductOptionTranslation } from './product-option-translation.entity';

/**
 * @description
 * A ProductOption is used to differentiate {@link ProductVariant}s from one another.
 *
 * @docsCategory entities
 */
@Entity()
export class ProductOption
    extends VendureEntity
    implements Translatable, HasCustomFields, SoftDeletable, ChannelAware
{
    constructor(input?: DeepPartial<ProductOption>) {
        super(input);
    }
    @Column({ type: Date, nullable: true })
    deletedAt: Date | null;

    name: LocaleString;

    @Column() code: string;

    @OneToMany(type => ProductOptionTranslation, translation => translation.base, { eager: true })
    translations: Array<Translation<ProductOption>>;

    @Index()
    @ManyToOne(type => ProductOptionGroup, group => group.options)
    group: ProductOptionGroup;

    @EntityId()
    groupId: ID;

    @ManyToMany(type => ProductVariant, variant => variant.options)
    productVariants: ProductVariant[];

    @ManyToMany(type => Channel, channel => channel.productOptions)
    @JoinTable()
    channels: Channel[];

    @Column(type => CustomProductOptionFields)
    customFields: CustomProductOptionFields;
}
